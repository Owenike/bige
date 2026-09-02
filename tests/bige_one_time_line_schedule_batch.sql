begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '4f100000-0000-4000-8000-000000000001';
  branch_id uuid := '4f200000-0000-4000-8000-000000000001';
  manager_id uuid := '4f300000-0000-4000-8000-000000000001';
  member_a_id uuid := '4f400000-0000-4000-8000-000000000001';
  member_b_id uuid := '4f400000-0000-4000-8000-000000000002';
  binding_id uuid := '4f500000-0000-4000-8000-000000000001';
  scheduled_time timestamptz := now() + interval '30 minutes';
  schedule_month_value date := date_trunc('month', now())::date;
  duplicate_inserted boolean;
  queued_count integer;
  original_notification_id uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'one-time-line-batch-manager@test.local',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'ONE TIME LINE BATCH TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'ONE TIME LINE TEST BRANCH', 'ONE-TIME-LINE', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active
  ) values (
    manager_id, tenant_id, branch_id, 'manager', 'One-time Line Manager', true
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, status, is_prospect, member_code
  ) values
    (member_a_id, tenant_id, branch_id, 'One-time Member A', '0919900001', 'active', false, 'E990001'),
    (member_b_id, tenant_id, branch_id, 'One-time Member B', '0919900002', 'active', false, 'E990002');

  insert into public.bige_line_group_bindings (
    id, tenant_id, member_id, line_group_id, group_name, verification_code,
    status, verified_at, verified_by, created_by
  ) values (
    binding_id, tenant_id, member_a_id, 'C-ONE-TIME-LINE-TEST',
    'One-time LINE Test Group', 'BCDEF123', 'active', now(), manager_id, manager_id
  );

  insert into public.bige_line_group_binding_members (
    tenant_id, binding_id, member_id, created_by
  ) values
    (tenant_id, binding_id, member_a_id, manager_id),
    (tenant_id, binding_id, member_b_id, manager_id)
  on conflict do nothing;

  perform public.bige_queue_line_schedule_notification_v3(
    tenant_id, branch_id, member_a_id, binding_id, 'updated',
    'Member A September schedule', '[{"member":"A"}]'::jsonb,
    'one-time-line-member-a-0001', manager_id, null,
    scheduled_time, schedule_month_value, 'one-time:test-batch-0001'
  );
  perform public.bige_queue_line_schedule_notification_v3(
    tenant_id, branch_id, member_b_id, binding_id, 'updated',
    'Member B September schedule', '[{"member":"B"}]'::jsonb,
    'one-time-line-member-b-0001', manager_id, null,
    scheduled_time, schedule_month_value, 'one-time:test-batch-0001'
  );

  select result.inserted into duplicate_inserted
  from public.bige_queue_line_schedule_notification_v3(
    tenant_id, branch_id, member_a_id, binding_id, 'updated',
    'Member A duplicate schedule', '[{"member":"A-duplicate"}]'::jsonb,
    'one-time-line-member-a-0001', manager_id, null,
    scheduled_time, schedule_month_value, 'one-time:test-batch-0001'
  ) result;
  if duplicate_inserted then
    raise exception 'duplicate queue call must stay idempotent';
  end if;

  select count(*)::integer into queued_count
  from public.bige_line_schedule_notifications notification
  where notification.tenant_id = test_block.tenant_id
    and notification.batch_key = 'one-time:test-batch-0001'
    and notification.status = 'pending'
    and notification.scheduled_for = test_block.scheduled_time
    and notification.next_retry_at = test_block.scheduled_time
    and notification.schedule_month = test_block.schedule_month_value;
  if queued_count <> 2 then
    raise exception 'one-time batch must retain exactly two due-time rows';
  end if;

  if (
    select count(distinct notification.member_id)
    from public.bige_line_schedule_notifications notification
    where notification.tenant_id = test_block.tenant_id
      and notification.batch_key = 'one-time:test-batch-0001'
  ) <> 2 then
    raise exception 'shared group one-time messages must remain member-specific';
  end if;

  perform public.bige_queue_line_schedule_notification_v2(
    tenant_id, branch_id, member_a_id, binding_id, 'created',
    'Ordinary current schedule', '[]'::jsonb,
    'ordinary-line-member-a-0001', manager_id, null
  );
  if not exists (
    select 1
    from public.bige_line_schedule_notifications notification
    where notification.tenant_id = test_block.tenant_id
      and notification.member_id = test_block.member_a_id
      and notification.batch_key = 'one-time:test-batch-0001'
      and notification.status = 'pending'
  ) then
    raise exception 'ordinary schedule changes must not cancel one-time batches';
  end if;

  select notification.id into original_notification_id
  from public.bige_line_schedule_notifications notification
  where notification.dedupe_key = 'one-time-line-member-a-0001';
  update public.bige_line_schedule_notifications
  set status = 'failed'
  where id = original_notification_id;
  perform public.bige_queue_line_schedule_notification_v3(
    tenant_id, branch_id, member_a_id, binding_id, 'updated',
    'Member A explicit one-time retry', '[{"member":"A-retry"}]'::jsonb,
    'one-time-line-member-a-retry-0001', manager_id, original_notification_id,
    now(), schedule_month_value, 'manual-retry:one-time-member-a-0001'
  );
  if not exists (
    select 1
    from public.bige_line_schedule_notifications notification
    where notification.id = test_block.original_notification_id
      and notification.status = 'cancelled'
      and notification.resolution_reason = 'manual_resend_requested'
  ) then
    raise exception 'explicit retry must resolve the failed one-time notification';
  end if;
  if not exists (
    select 1
    from public.bige_line_schedule_notifications notification
    where notification.dedupe_key = 'one-time-line-member-a-retry-0001'
      and notification.status = 'pending'
      and notification.schedule_month = test_block.schedule_month_value
      and notification.batch_key = 'manual-retry:one-time-member-a-0001'
  ) then
    raise exception 'one-time retry must preserve its selected month';
  end if;

  if (
    select count(*)
    from public.audit_logs log
    where log.tenant_id = test_block.tenant_id
      and log.action = 'bige_line_schedule_one_time_batch_queued'
  ) <> 2 then
    raise exception 'each one-time member notification must be audited';
  end if;
end;
$$;

rollback;
