-- Coach assistant managers and city managers use legacy supervisor/branch-manager
-- roles. Keep their cross-coach schedule access read-only at the database layer.
drop policy if exists bige_schedule_notes_schedule_lead_read on public.bige_schedule_notes;

create policy bige_schedule_notes_schedule_lead_read
  on public.bige_schedule_notes
  for select
  to authenticated
  using (
    public.current_is_active()
    and tenant_id = public.current_tenant_id()
    and (public.current_profile()).role in ('supervisor', 'branch_manager')
  );;
