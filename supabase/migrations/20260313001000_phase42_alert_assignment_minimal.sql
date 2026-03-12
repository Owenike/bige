-- Phase 4-2: alert assignment minimal slice.
-- Scope: assignment metadata on notification_alert_workflows.

alter table public.notification_alert_workflows
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null,
  add column if not exists assignment_note text;

create index if not exists notification_alert_workflows_assignee_status_idx
  on public.notification_alert_workflows(assignee_user_id, status, updated_at desc);
