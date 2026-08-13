-- Run this once in existing projects before deploying the filtered report loading changes.

create or replace view public.report_filters as
select
  g.id as group_id,
  g.department,
  g.semester,
  g.section,
  sub.id as subject_id,
  sub.name as subject_name,
  sub.code as subject_code
from public.academic_groups g
join public.subjects sub on sub.group_id = g.id;

revoke all on public.report_filters from anon, authenticated;
grant select on public.report_filters to anon, authenticated;
