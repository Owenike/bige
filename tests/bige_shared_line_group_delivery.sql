begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '3f100000-0000-4000-8000-000000000001';
  branch_id uuid := '3f200000-0000-4000-8000-000000000001';
  manager_id uuid := '3f300000-0000-4000-8000-000000000001';
  owner_member_id uuid := '3f400000-0000-4000-8000-000000000001';
  participant_a_id uuid := '3f400000-0000-4000-8000-000000000002';
  participant_b_id uuid := '3f400000-0000-4000-8000-000000000003';
  unrelated_member_id uuid := '3f400000-0000-4000-8000-000000000004';
  binding_id uuid := '3f500000-0000-4000-8000-000000000001';
  queued_count integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'shared-line-group-manager@test.local',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'SHARED LINE GROUP TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'SHARED LINE TEST BRANCH', 'SHARED-LINE', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active
  ) values (
    manager_id, tenant_id, branch_id, 'manager', 'Shared Line Manager', true
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, status, is_prospect, member_code
  ) values
    (owner_member_id, tenant_id, branch_id, 'LINE Owner', '0919800001', 'active', false, 'E980001'),
    (participant_a_id, tenant_id, branch_id, 'LINE Participant A', '0919800002', 'active', false, 'E980002'),
    (participant_b_id, tenant_id, branch_id, 'LINE Participant B', '0919800003', 'active', false, 'E980003'),
    (unrelated_member_id, tenant_id, branch_id, 'LINE Unrelated', '0919800004', 'active', false, 'E980004');

  insert into public.bige_line_group_bindings (
    id, tenant_id, member_id, line_group_id, group_name, verification_code,
    status, verified_at, verified_by, created_by
  ) values (
    binding_id, tenant_id, owner_member_id, 'C-SHARED-LINE-TEST',
    'Shared LINE Test Group', 'ABCDEF12', 'active', now(), manager_id, manager_id
  );

  insert into public.bige_line_group_binding_members (
    tenant_id, binding_id, member_id, created_by
  ) values
    (tenant_id, binding_id, participant_a_id, manager_id),
    (tenant_id, binding_id, participant_b_id, manager_id);

  perform public.bige_queue_line_schedule_notification_v2(
    tenant_id, branch_id, owner_member_id, binding_id, 'created',
    'Owner schedule', '[]'::jsonb, 'shared-line-owner-0001', manager_id, null
  );
  perform public.bige_queue_line_schedule_notification_v2(
    tenant_id, branch_id, participant_a_id, binding_id, 'created',
    'Participant A schedule', '[]'::jsonb, 'shared-line-participant-a-0001', manager_id, null
  );
  perform public.bige_queue_line_schedule_notification_v2(
    tenant_id, branch_id, participant_b_id, binding_id, 'created',
    'Participant B schedule', '[]'::jsonb, 'shared-line-participant-b-0001', manager_id, null
  );

  select count(*)::integer into queued_count
  from public.bige_line_schedule_notifications notification
  where notification.tenant_id = test_block.tenant_id
    and notification.binding_id = test_block.binding_id
    and notification.status = 'pending';

  if queued_count <> 3 then
    raise exception 'owner and both shared participants should queue to the same LINE group';
  end if;

  if (
    select count(distinct notification.member_id)
    from public.bige_line_schedule_notifications notification
    where notification.tenant_id = test_block.tenant_id
      and notification.binding_id = test_block.binding_id
  ) <> 3 then
    raise exception 'shared LINE notifications must remain member-specific';
  end if;

  begin
    perform public.bige_queue_line_schedule_notification_v2(
      tenant_id, branch_id, unrelated_member_id, binding_id, 'created',
      'Unrelated schedule', '[]'::jsonb, 'shared-line-unrelated-0001', manager_id, null
    );
    raise exception 'unrelated member should not queue to the shared LINE group';
  exception
    when others then
      if sqlerrm <> 'line_group_binding_inactive' then
        raise;
      end if;
  end;

  update public.bige_line_group_bindings
  set status = 'disabled'
  where id = binding_id;

  begin
    perform public.bige_queue_line_schedule_notification_v2(
      tenant_id, branch_id, participant_a_id, binding_id, 'updated',
      'Inactive group schedule', '[]'::jsonb, 'shared-line-inactive-0001', manager_id, null
    );
    raise exception 'inactive shared LINE group should reject notification queueing';
  exception
    when others then
      if sqlerrm <> 'line_group_binding_inactive' then
        raise;
      end if;
  end;
end;
$$;

rollback;
