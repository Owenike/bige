-- Notification productization test seed (non-production).
-- Replace tenant/profile ids before use.

-- Example tenant and actor IDs (replace these):
-- tenant: 11111111-1111-4111-8111-111111111111
-- actor:  22222222-2222-4222-8222-222222222222

insert into public.notification_role_preferences (
  tenant_id,
  role,
  event_type,
  channels,
  is_enabled,
  source,
  note,
  created_by,
  updated_by
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'manager',
    'opportunity_due',
    '{"in_app":true,"email":true,"line":false,"sms":false,"webhook":false}'::jsonb,
    true,
    'custom',
    'seed: manager opportunity due',
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222'
  )
on conflict (tenant_id, role, event_type) do update
set
  channels = excluded.channels,
  is_enabled = excluded.is_enabled,
  source = excluded.source,
  note = excluded.note,
  updated_by = excluded.updated_by,
  updated_at = now();

insert into public.notification_templates (
  tenant_id,
  event_type,
  channel,
  locale,
  title_template,
  message_template,
  priority,
  channel_policy,
  is_active,
  version,
  created_by,
  updated_by
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'opportunity_due',
    'email',
    'zh-TW',
    'Opportunity reminder',
    'Lead {{lead_name}} has an opportunity due.',
    'warning',
    '{"allowExternal":true,"maxRetries":2}'::jsonb,
    true,
    1,
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222'
  )
on conflict do nothing;

insert into public.notification_admin_audit_logs (
  tenant_id,
  actor_user_id,
  actor_role,
  scope,
  action,
  target_type,
  target_id,
  before_data,
  after_data,
  diff,
  metadata
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'manager',
    'tenant',
    'preference_upsert',
    'notification_role_preferences',
    'seed:manager:opportunity_due',
    '{}'::jsonb,
    '{"channels":{"in_app":true,"email":true}}'::jsonb,
    '{"channels":{"before":{},"after":{"in_app":true,"email":true}}}'::jsonb,
    '{"seed":"notification_productization_test_seed"}'::jsonb
  );
