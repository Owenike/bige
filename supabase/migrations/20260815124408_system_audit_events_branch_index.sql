create index if not exists system_audit_events_branch_created_idx
  on public.system_audit_events(branch_id, created_at desc);
