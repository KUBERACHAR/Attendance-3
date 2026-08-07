-- Run this once only if the Supabase project was created with a unique subject code constraint.

alter table public.subjects
  drop constraint if exists subjects_code_key;

drop index if exists public.subjects_code_key;
