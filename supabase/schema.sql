
create extension if not exists "pgcrypto";

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
  name text not null,
  code text not null unique,
  department text not null,
  semester text not null,
  faculty_id uuid references public.faculties(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  roll_no text not null unique,
  name text not null,
  department text not null,
  semester text not null,
  section text not null default 'A',
  group_id uuid references public.academic_groups(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  attendance_date date not null default current_date,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  unique (student_id, subject_id, attendance_date)
);

-- Keep the schema compatible with databases created from earlier project versions.
alter table public.faculties add column if not exists faculty_login_id text;
alter table public.faculties add column if not exists is_active boolean not null default true;
alter table public.subjects add column if not exists department text not null default 'General';
alter table public.students add column if not exists section text not null default 'A';
alter table public.students add column if not exists group_id uuid references public.academic_groups(id) on delete set null;

create unique index if not exists faculties_faculty_login_id_key
  on public.faculties(faculty_login_id);

create unique index if not exists academic_groups_unique_key
  on public.academic_groups(department, semester, section);

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
    from public.subjects
    where id = subject_uuid
      and faculty_id = public.current_faculty_id()
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
  sub.faculty_id,
  f.name as faculty_name,
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
  on sub.department = s.department
 and sub.semester = s.semester
left join public.faculties f
  on f.id = sub.faculty_id
left join public.attendance_records ar
  on ar.student_id = s.id
 and ar.subject_id = sub.id
group by s.id, sub.id, f.name;

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
drop policy if exists "Admins manage students" on public.students;
drop policy if exists "Faculty can read students" on public.students;
drop policy if exists "Admins manage attendance" on public.attendance_records;
drop policy if exists "Faculty read assigned attendance" on public.attendance_records;
drop policy if exists "Faculty create assigned attendance" on public.attendance_records;
drop policy if exists "Faculty update assigned attendance" on public.attendance_records;
drop policy if exists "Faculty delete assigned attendance" on public.attendance_records;

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

create policy "Faculty can read assigned subjects"
on public.subjects
for select
using (faculty_id = public.current_faculty_id());

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

create policy "Faculty read assigned attendance"
on public.attendance_records
for select
using (public.is_faculty_for_subject(subject_id));

create policy "Faculty create assigned attendance"
on public.attendance_records
for insert
with check (public.is_faculty_for_subject(subject_id));

create policy "Faculty update assigned attendance"
on public.attendance_records
for update
using (public.is_faculty_for_subject(subject_id))
with check (public.is_faculty_for_subject(subject_id));

create policy "Faculty delete assigned attendance"
on public.attendance_records
for delete
using (public.is_faculty_for_subject(subject_id));

grant execute on function public.get_faculty_login(text) to anon, authenticated;
grant execute on function public.get_current_role() to authenticated;
grant select on public.attendance_report to anon, authenticated;