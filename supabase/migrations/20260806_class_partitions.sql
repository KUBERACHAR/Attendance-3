-- One-time migration from the previous shared-table schema.
-- Run this file in the Supabase SQL Editor for an existing installation.

begin;

create extension if not exists "pgcrypto";

create schema if not exists class_data;
revoke all on schema class_data from public, anon, authenticated;

drop view if exists public.attendance_calendar;
drop view if exists public.attendance_report;

alter table public.subjects
  add column if not exists group_id uuid;

update public.subjects
set section = 'A'
where section is null or btrim(section) = '';

insert into public.academic_groups (department, semester, section)
select distinct department, semester, section
from public.students
where group_id is null
on conflict (department, semester, section) do nothing;

insert into public.academic_groups (department, semester, section)
select distinct department, semester, section
from public.subjects
where group_id is null
on conflict (department, semester, section) do nothing;

update public.students s
set group_id = g.id
from public.academic_groups g
where s.group_id is null
  and g.department = s.department
  and g.semester = s.semester
  and g.section = s.section;

update public.subjects sub
set group_id = g.id
from public.academic_groups g
where sub.group_id is null
  and g.department = sub.department
  and g.semester = sub.semester
  and g.section = sub.section;

do $$
begin
  if exists (
    select 1
    from public.students
    where group_id is null
  ) then
    raise exception 'Migration stopped: some students could not be matched to a class.';
  end if;

  if exists (
    select 1
    from public.subjects
    where group_id is null
  ) then
    raise exception 'Migration stopped: some subjects could not be matched to a class.';
  end if;

  if exists (
    select 1
    from public.attendance_records ar
    join public.students s on s.id = ar.student_id
    join public.subjects sub on sub.id = ar.subject_id
    where s.group_id is distinct from sub.group_id
  ) then
    raise exception
      'Migration stopped: attendance contains a student and subject from different classes.';
  end if;
end;
$$;

alter table public.subjects
  alter column group_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subjects'::regclass
      and conname = 'subjects_group_id_fkey'
  ) then
    alter table public.subjects
      add constraint subjects_group_id_fkey
      foreign key (group_id)
      references public.academic_groups(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subjects'::regclass
      and conname = 'subjects_group_id_id_key'
  ) then
    alter table public.subjects
      add constraint subjects_group_id_id_key
      unique (group_id, id);
  end if;
end;
$$;

alter table public.attendance_records
  rename to attendance_records_legacy;

alter table public.students
  rename to students_legacy;

create table public.students (
  id uuid not null default gen_random_uuid(),
  group_id uuid not null references public.academic_groups(id) on delete restrict,
  roll_no text not null,
  name text not null,
  department text not null,
  semester text not null,
  section text not null default 'A',
  created_at timestamptz not null default now(),
  constraint students_partitioned_pkey primary key (group_id, id),
  constraint students_group_roll_key unique (group_id, roll_no)
) partition by list (group_id);

create table public.attendance_records (
  id uuid not null default gen_random_uuid(),
  group_id uuid not null,
  student_id uuid not null,
  subject_id uuid not null,
  attendance_date date not null default current_date,
  status text not null check (status in ('present', 'absent')),
  created_at timestamptz not null default now(),
  constraint attendance_partitioned_pkey primary key (group_id, id),
  constraint attendance_student_fkey
    foreign key (group_id, student_id)
    references public.students(group_id, id)
    on delete cascade,
  constraint attendance_subject_fkey
    foreign key (group_id, subject_id)
    references public.subjects(group_id, id)
    on delete cascade,
  constraint attendance_group_student_subject_date_key
    unique (group_id, student_id, subject_id, attendance_date)
) partition by list (group_id);

do $$
declare
  class_row record;
  class_suffix text;
begin
  for class_row in
    select id from public.academic_groups
  loop
    class_suffix := replace(class_row.id::text, '-', '');

    execute format(
      'create table class_data.%I
         partition of public.students for values in (%L)',
      'students_c_' || class_suffix,
      class_row.id
    );

    execute format(
      'create table class_data.%I
         partition of public.attendance_records for values in (%L)',
      'attendance_c_' || class_suffix,
      class_row.id
    );
  end loop;
end;
$$;

insert into public.students (
  id,
  group_id,
  roll_no,
  name,
  department,
  semester,
  section,
  created_at
)
select
  id,
  group_id,
  roll_no,
  name,
  department,
  semester,
  section,
  created_at
from public.students_legacy;

insert into public.attendance_records (
  id,
  group_id,
  student_id,
  subject_id,
  attendance_date,
  status,
  created_at
)
select
  ar.id,
  s.group_id,
  ar.student_id,
  ar.subject_id,
  ar.attendance_date,
  ar.status,
  ar.created_at
from public.attendance_records_legacy ar
join public.students_legacy s
  on s.id = ar.student_id;

do $$
begin
  if (
    select count(*) from public.students
  ) <> (
    select count(*) from public.students_legacy
  ) then
    raise exception 'Migration stopped: student row counts do not match.';
  end if;

  if (
    select count(*) from public.attendance_records
  ) <> (
    select count(*) from public.attendance_records_legacy
  ) then
    raise exception 'Migration stopped: attendance row counts do not match.';
  end if;
end;
$$;

drop table public.attendance_records_legacy;
drop table public.students_legacy;

create index attendance_records_subject_date_idx
  on public.attendance_records(group_id, subject_id, attendance_date);

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

revoke all on function public.ensure_class_partitions(uuid) from public, anon, authenticated;
revoke all on function public.create_class_partitions() from public, anon, authenticated;
revoke all on function public.delete_class_partitions() from public, anon, authenticated;

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

alter table public.students enable row level security;
alter table public.attendance_records enable row level security;

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
grant select on public.attendance_report to anon, authenticated;
grant select on public.attendance_calendar to anon, authenticated;

commit;
