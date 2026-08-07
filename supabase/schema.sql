-- Fresh database schema.
-- Run this file once in the SQL Editor of a new Supabase project.
-- Student rows are stored in a separate physical table for every class.

create extension if not exists "pgcrypto";

create schema class_data;
revoke all on schema class_data from public, anon, authenticated;

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table public.academic_groups (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  semester text not null,
  section text not null,
  student_table_name text generated always as (
    'students_c_' || replace(id::text, '-', '')
  ) stored unique,
  created_at timestamptz not null default now(),
  unique (department, semester, section)
);

create table public.faculties (
  id uuid primary key default gen_random_uuid(),
  faculty_login_id text not null unique,
  name text not null,
  email text not null unique,
  department text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.academic_groups(id) on delete cascade,
  name text not null,
  code text not null unique,
  department text not null,
  semester text not null,
  section text not null,
  created_at timestamptz not null default now(),
  unique (group_id, id)
);

create view public.students as
select
  null::uuid as id,
  null::uuid as group_id,
  null::text as roll_no,
  null::text as name,
  null::text as department,
  null::text as semester,
  null::text as section,
  null::timestamptz as created_at
where false;

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  student_id uuid not null,
  subject_id uuid not null,
  attendance_date date not null default current_date,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  foreign key (group_id, subject_id)
    references public.subjects(group_id, id)
    on delete cascade,
  unique (group_id, student_id, subject_id, attendance_date)
);

create index attendance_records_subject_date_idx
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

create or replace function public.refresh_students_view(excluded_class_uuid uuid default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  students_query text;
begin
  select string_agg(
    format(
      'select s.id,
              g.id as group_id,
              s.roll_no,
              s.name,
              g.department,
              g.semester,
              g.section,
              s.created_at
         from class_data.%I s
         join public.academic_groups g on g.id = %L::uuid',
      g.student_table_name,
      g.id
    ),
    ' union all '
    order by g.created_at, g.id
  )
  into students_query
  from public.academic_groups g
  where (excluded_class_uuid is null or g.id <> excluded_class_uuid)
    and to_regclass(format('class_data.%I', g.student_table_name)) is not null;

  if students_query is null then
    students_query := '
      select
        null::uuid as id,
        null::uuid as group_id,
        null::text as roll_no,
        null::text as name,
        null::text as department,
        null::text as semester,
        null::text as section,
        null::timestamptz as created_at
      where false';
  end if;

  execute 'create or replace view public.students as ' || students_query;
end;
$$;

create or replace function public.create_class_student_table()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  execute format(
    'create table class_data.%I (
       id uuid primary key default gen_random_uuid(),
       roll_no text not null unique,
       name text not null,
       created_at timestamptz not null default now()
     )',
    new.student_table_name
  );

  execute format(
    'alter table class_data.%I enable row level security',
    new.student_table_name
  );

  execute format(
    'revoke all on table class_data.%I from public, anon, authenticated',
    new.student_table_name
  );

  perform public.refresh_students_view();
  return new;
end;
$$;

create or replace function public.delete_class_student_table()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.refresh_students_view(old.id);

  execute format(
    'drop table if exists class_data.%I',
    old.student_table_name
  );

  return old;
end;
$$;

create trigger create_class_storage
after insert on public.academic_groups
for each row execute function public.create_class_student_table();

create trigger delete_class_storage
before delete on public.academic_groups
for each row execute function public.delete_class_student_table();

create or replace function public.list_students()
returns table(
  id uuid,
  group_id uuid,
  roll_no text,
  name text,
  department text,
  semester text,
  section text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_admin()
     and public.current_faculty_id() is null then
    raise exception 'Only admins and active faculty can view students.'
      using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.group_id,
    s.roll_no,
    s.name,
    s.department,
    s.semester,
    s.section,
    s.created_at
  from public.students s
  order by s.roll_no;
end;
$$;

create or replace function public.upsert_class_students(
  class_uuid uuid,
  student_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_table text;
  affected_rows integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage students.'
      using errcode = '42501';
  end if;

  if student_rows is null or jsonb_typeof(student_rows) <> 'array' then
    raise exception 'student_rows must be a JSON array.';
  end if;

  select student_table_name
  into target_table
  from public.academic_groups
  where id = class_uuid;

  if target_table is null then
    raise exception 'Class % does not exist.', class_uuid;
  end if;

  execute format(
    'insert into class_data.%I (roll_no, name)
     select distinct on (btrim(row_data.roll_no))
       btrim(row_data.roll_no),
       btrim(row_data.name)
     from jsonb_to_recordset($1) as row_data(roll_no text, name text)
     where nullif(btrim(row_data.roll_no), '''') is not null
       and nullif(btrim(row_data.name), '''') is not null
     order by btrim(row_data.roll_no)
     on conflict (roll_no)
     do update set name = excluded.name',
    target_table
  )
  using student_rows;

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

create or replace function public.delete_class_student(
  class_uuid uuid,
  student_uuid uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_table text;
  affected_rows integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage students.'
      using errcode = '42501';
  end if;

  select student_table_name
  into target_table
  from public.academic_groups
  where id = class_uuid;

  if target_table is null then
    raise exception 'Class % does not exist.', class_uuid;
  end if;

  execute format(
    'delete from class_data.%I where id = $1',
    target_table
  )
  using student_uuid;

  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    delete from public.attendance_records
    where group_id = class_uuid
      and student_id = student_uuid;
  end if;

  return affected_rows > 0;
end;
$$;

create or replace function public.validate_attendance_student()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_table text;
  student_exists boolean;
begin
  select student_table_name
  into target_table
  from public.academic_groups
  where id = new.group_id;

  if target_table is null then
    raise exception 'Class % does not exist.', new.group_id;
  end if;

  execute format(
    'select exists (
       select 1
       from class_data.%I
       where id = $1
     )',
    target_table
  )
  into student_exists
  using new.student_id;

  if not student_exists then
    raise exception 'Student % does not belong to class %.',
      new.student_id,
      new.group_id;
  end if;

  return new;
end;
$$;

create trigger validate_attendance_student
before insert or update on public.attendance_records
for each row execute function public.validate_attendance_student();

create view public.attendance_report as
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

create view public.attendance_calendar as
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
alter table public.attendance_records enable row level security;

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

revoke all on public.admin_users from anon, authenticated;
revoke all on public.academic_groups from anon, authenticated;
revoke all on public.faculties from anon, authenticated;
revoke all on public.subjects from anon, authenticated;
revoke all on public.students from anon, authenticated;
revoke all on public.attendance_records from anon, authenticated;
revoke all on public.attendance_report from anon, authenticated;
revoke all on public.attendance_calendar from anon, authenticated;

grant select, insert, update, delete on public.admin_users to authenticated;
grant select, insert, update, delete on public.academic_groups to authenticated;
grant select, insert, update, delete on public.faculties to authenticated;
grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant select on public.attendance_report to anon, authenticated;
grant select on public.attendance_calendar to anon, authenticated;

revoke all on function public.current_user_email() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.current_faculty_id() from public;
revoke all on function public.is_faculty_for_subject(uuid) from public;
revoke all on function public.get_faculty_login(text) from public;
revoke all on function public.get_current_role() from public;
revoke all on function public.refresh_students_view(uuid) from public;
revoke all on function public.create_class_student_table() from public;
revoke all on function public.delete_class_student_table() from public;
revoke all on function public.list_students() from public;
revoke all on function public.upsert_class_students(uuid, jsonb) from public;
revoke all on function public.delete_class_student(uuid, uuid) from public;
revoke all on function public.validate_attendance_student() from public;

grant execute on function public.current_user_email() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_faculty_id() to authenticated;
grant execute on function public.is_faculty_for_subject(uuid) to authenticated;
grant execute on function public.get_faculty_login(text) to anon, authenticated;
grant execute on function public.get_current_role() to authenticated;
grant execute on function public.list_students() to authenticated;
grant execute on function public.upsert_class_students(uuid, jsonb) to authenticated;
grant execute on function public.delete_class_student(uuid, uuid) to authenticated;
