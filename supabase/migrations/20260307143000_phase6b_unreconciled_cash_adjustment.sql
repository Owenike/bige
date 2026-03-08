-- Phase 6b: unreconciled event query and shift attach/cash adjustment readiness.
-- Keep using existing frontdesk_shift_items / audit_logs model, only add query-performance indexes.

create index if not exists frontdesk_shift_items_tenant_event_ref_idx
  on public.frontdesk_shift_items(tenant_id, event_type, ref_id)
  where ref_id is not null;

create index if not exists audit_logs_tenant_action_target_created_idx
  on public.audit_logs(tenant_id, action, target_id, created_at desc);
