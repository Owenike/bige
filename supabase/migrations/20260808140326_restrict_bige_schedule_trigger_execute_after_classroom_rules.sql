begin;

-- Trigger functions execute through their trigger and must not be exposed as
-- callable Data API RPCs to ordinary signed-in users.
revoke all on function public.enforce_bige_schedule_single_entry_cell()
  from public, anon, authenticated;

grant execute on function public.enforce_bige_schedule_single_entry_cell()
  to service_role;

commit;
