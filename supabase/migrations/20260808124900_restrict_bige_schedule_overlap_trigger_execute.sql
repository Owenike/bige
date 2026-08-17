begin;

revoke all on function public.enforce_bige_schedule_single_entry_cell()
  from public, anon, authenticated;

grant execute on function public.enforce_bige_schedule_single_entry_cell()
  to service_role;

commit;
