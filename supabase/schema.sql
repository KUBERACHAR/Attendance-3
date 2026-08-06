-- Fresh database schema.
-- Existing installations must run supabase/migrations/20260806_class_partitions.sql
-- instead so current students and attendance records are preserved.

create extension if not exists "pgcrypto";

create schema if not exists class_data;
revoke all on schema class_data from public, anon, authenticated;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_groups (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  semester text not null,
  section text not null,
  created_at timestamptz not null default now(),
  unique (department, semester, section)
);

create table if not exists public.faculties (
  id uuid primary key default gen_random_uuid(),
  faculty_login_id text not null unique,
  name text not null,
  email text not null unique,
  department text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.academic_groups(id) on delete restrict,
  name text not null,
  code text not null unique,
  department text not null,
  semester text not null,
  section text not null,
  created_at timestamptz not null default now(),
  unique (group_id, id)
);

create table if not exists public.students (
  id uuid not null default gen_random_uuid(),
  group_id uuid not null references public.academic_groups(id) on delete restrict,
  roll_no text not null,
  name text not null,
  department text not null,
  semester text not null,
  section text not null default 'A',
  created_at timestamptz not null default now(),
  primary key (group_id, id),
  unique (group_id, roll_no)
) partition by list (group_id);

create table if not exists public.attendance_records (
  id uuid not null default gen_random_uuid(),
  group_id uuid not null,
  student_id uuid not null,
  subject_id uuid not null,
  attendance_date date not null default current_date,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  primary key (group_id, id),
  foreign key (group_id, student_id)
    references public.students(group_id, id)
    on delete cascade,
  foreign key (group_id, subject_id)
    references public.subjects(group_id, id)
    on delete cascade,
  unique (group_id, student_id, subject_id, attendance_date)
) partition by list (group_id);

create unique index if not exists faculties_faculty_login_id_key
  on public.faculties(faculty_login_id);

create unique index if not exists academic_groups_unique_key
  on public.academic_groups(department, semester, section);

create index if not exists attendance_records_subject_date_idx
  on public.attendance_records(group_id, subject_id, attendance_date);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = public.current_user_email()
  );
$$;

create or replace function public.current_faculty_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.faculties
  where lower(email) = public.current_user_email()
    and is_active = true
  limit 1;
$$;

drop function if exists public.is_faculty_for_subject(uuid);

create or replace function public.is_faculty_for_subject(subject_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subjects sub
    join public.faculties f
      on f.id = public.current_faculty_id()
    where sub.id = subject_uuid
      and sub.department = f.department
  );
$$;

create or replace function public.get_faculty_login(login_id text)
returns table(email text, name text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.email, f.name, f.is_active
  from public.faculties f
  where f.faculty_login_id = login_id
  limit 1;
$$;

create or replace function public.get_current_role()
returns table(role text, faculty_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when public.is_admin() then 'admin'
      when f.id is not null then 'faculty'
      else 'student'
    end as role,
    f.id as faculty_id,
    f.name as name
  from (select 1) seed
  left join public.faculties f
    on lower(f.email) = public.current_user_email()
   and f.is_active = true
  limit 1;
$$;

create or replace function public.ensure_class_partitions(class_uuid uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  class_suffix text;
  student_partition text;
  attendance_partition text;
begin
  if not exists (
    select 1
    from public.academic_groups
    where id = class_uuid
  ) then
    raise exception 'Class % does not exist.', class_uuid;
  end if;

  class_suffix := replace(class_uuid::text, '-', '');
  student_partition := 'students_c_' || class_suffix;
  attendance_partition := 'attendance_c_' || class_suffix;

  execute format(
    'create table if not exists class_data.%I
       partition of public.students for values in (%L)',
    student_partition,
    class_uuid
  );

  execute format(
    'create table if not exists class_data.%I
       partition of public.attendance_records for values in (%L)',
    attendance_partition,
    class_uuid
  );

  execute format(
    'revoke all on table class_data.%I from public, anon, authenticated',
    student_partition
  );

  execute format(
    'revoke all on table class_data.%I from public, anon, authenticated',
    attendance_partition
  );
end;
$$;

create or replace function public.create_class_partitions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.ensure_class_partitions(new.id);
  return new;
end;
$$;

create or replace function public.delete_class_partitions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  class_suffix text;
begin
  class_suffix := replace(old.id::text, '-', '');

  delete from public.attendance_records where group_id = old.id;
  delete from public.students where group_id = old.id;
  delete from public.subjects where group_id = old.id;

  execute format(
    'drop table if exists class_data.%I',
    'attendance_c_' || class_suffix
  );

  execute format(
    'drop table if exists class_data.%I',
    'students_c_' || class_suffix
  );

  return old;
end;
$$;

drop trigger if exists create_class_storage on public.academic_groups;
create trigger create_class_storage
after insert on public.academic_groups
for each row execute function public.create_class_partitions();

drop trigger if exists delete_class_storage on public.academic_groups;
create trigger delete_class_storage
before delete on public.academic_groups
for each row execute function public.delete_class_partitions();

do $$
declare
  class_row record;
begin
  for class_row in
    select id from public.academic_groups
  loop
    perform public.ensure_class_partitions(class_row.id);
  end loop;
end;
$$;

revoke all on function public.ensure_class_partitions(uuid) from public, anon, authenticated;
revoke all on function public.create_class_partitions() from public, anon, authenticated;
revoke all on function public.delete_class_partitions() from public, anon, authenticated;

drop view if exists public.attendance_calendar;
drop view if exists public.attendance_report;

create or replace view public.attendance_report as
select
  s.id as student_id,
  s.roll_no,
  s.name as student_name,
  s.department,
  s.semester,
  s.section,
  s.group_id,
  sub.id as subject_id,
  sub.name as subject_name,
  sub.code as subject_code,
  count(ar.id) as total_classes,
  count(ar.id) filter (where ar.status = 'present') as present_count,
  count(ar.id) filter (where ar.status = 'absent') as absent_count,
  case
    when count(ar.id) = 0 then 0
    else round(
      (
        count(ar.id) filter (where ar.status = 'present')::numeric
        / count(ar.id)::numeric
      ) * 100,
      2
    )
  end as attendance_percentage
from public.students s
join public.subjects sub
  on sub.group_id = s.group_id
left join public.attendance_records ar
  on ar.group_id = s.group_id
 and ar.student_id = s.id
 and ar.subject_id = sub.id
group by
  s.group_id,
  s.id,
  s.roll_no,
  s.name,
  s.department,
  s.semester,
  s.section,
  sub.id,
  sub.name,
  sub.code;

create or replace view public.attendance_calendar as
select
  ar.group_id,
  ar.student_id,
  ar.subject_id,
  ar.attendance_date,
  ar.status
from public.attendance_records ar;

alter table public.admin_users enable row level security;
alter table public.academic_groups enable row level security;
alter table public.faculties enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists "Admins manage admin users" on public.admin_users;
drop policy if exists "Admins manage academic groups" on public.academic_groups;
drop policy if exists "Faculty can read academic groups" on public.academic_groups;
drop policy if exists "Admins manage faculties" on public.faculties;
drop policy if exists "Faculty can read own profile" on public.faculties;
drop policy if exists "Admins manage subjects" on public.subjects;
drop policy if exists "Faculty can read assigned subjects" on public.subjects;
drop policy if exists "Faculty can read department subjects" on public.subjects;
drop policy if exists "Admins manage students" on public.students;
drop policy if exists "Faculty can read students" on public.students;
drop policy if exists "Admins manage attendance" on public.attendance_records;
drop policy if exists "Faculty read assigned attendance" on public.attendance_records;
drop policy if exists "Faculty create assigned attendance" on public.attendance_records;
drop policy if exists "Faculty update assigned attendance" on public.attendance_records;
drop policy if exists "Faculty delete assigned attendance" on public.attendance_records;
drop policy if exists "Faculty read department attendance" on public.attendance_records;
drop policy if exists "Faculty create department attendance" on public.attendance_records;
drop policy if exists "Faculty update department attendance" on public.attendance_records;
drop policy if exists "Faculty delete department attendance" on public.attendance_records;

drop policy if exists "Allow anon read faculties" on public.faculties;
drop policy if exists "Allow anon insert faculties" on public.faculties;
drop policy if exists "Allow anon update faculties" on public.faculties;
drop policy if exists "Allow anon delete faculties" on public.faculties;
drop policy if exists "Allow anon read subjects" on public.subjects;
drop policy if exists "Allow anon insert subjects" on public.subjects;
drop policy if exists "Allow anon update subjects" on public.subjects;
drop policy if exists "Allow anon delete subjects" on public.subjects;
drop policy if exists "Allow anon read students" on public.students;
drop policy if exists "Allow anon insert students" on public.students;
drop policy if exists "Allow anon update students" on public.students;
drop policy if exists "Allow anon delete students" on public.students;
drop policy if exists "Allow anon read attendance" on public.attendance_records;
drop policy if exists "Allow anon insert attendance" on public.attendance_records;
drop policy if exists "Allow anon update attendance" on public.attendance_records;
drop policy if exists "Allow anon delete attendance" on public.attendance_records;

create policy "Admins manage admin users"
on public.admin_users
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admins manage academic groups"
on public.academic_groups
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Faculty can read academic groups"
on public.academic_groups
for select
using (public.current_faculty_id() is not null);

create policy "Admins manage faculties"
on public.faculties
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Faculty can read own profile"
on public.faculties
for select
using (
  lower(email) = public.current_user_email()
  and is_active = true
);

create policy "Admins manage subjects"
on public.subjects
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Faculty can read department subjects"
on public.subjects
for select
using (public.is_faculty_for_subject(id));

create policy "Admins manage students"
on public.students
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Faculty can read students"
on public.students
for select
using (public.current_faculty_id() is not null);

create policy "Admins manage attendance"
on public.attendance_records
for all
using (public.is_admin())
with check (public.is_admin());

create policy "Faculty read department attendance"
on public.attendance_records
for select
using (public.is_faculty_for_subject(subject_id));

create policy "Faculty create department attendance"
on public.attendance_records
for insert
with check (public.is_faculty_for_subject(subject_id));

create policy "Faculty update department attendance"
on public.attendance_records
for update
using (public.is_faculty_for_subject(subject_id))
with check (public.is_faculty_for_subject(subject_id));

create policy "Faculty delete department attendance"
on public.attendance_records
for delete
using (public.is_faculty_for_subject(subject_id));

grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant execute on function public.get_faculty_login(text) to anon, authenticated;
grant execute on function public.get_current_role() to authenticated;
grant select on public.attendance_report to anon, authenticated;
grant select on public.attendance_calendar to anon, authenticated;
