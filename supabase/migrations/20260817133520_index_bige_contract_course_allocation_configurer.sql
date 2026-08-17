create index if not exists member_plan_contracts_course_allocations_configured_by_idx
  on public.member_plan_contracts (course_allocations_configured_by)
  where course_allocations_configured_by is not null;

-- Production migration version: 20260817133520.
