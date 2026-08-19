begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '2f100000-0000-4000-8000-000000000001';
  branch_id uuid := '2f200000-0000-4000-8000-000000000001';
  manager_id uuid := '2f300000-0000-4000-8000-000000000001';
  owner_member_id uuid := '2f400000-0000-4000-8000-000000000001';
  participant_a_id uuid := '2f400000-0000-4000-8000-000000000002';
  participant_b_id uuid := '2f400000-0000-4000-8000-000000000003';
  unrelated_member_id uuid := '2f400000-0000-4000-8000-000000000004';
  contract_id uuid := '2f500000-0000-4000-8000-000000000001';
  owner_booking_id uuid := '2f600000-0000-4000-8000-000000000001';
  participant_a_booking_id uuid := '2f600000-0000-4000-8000-000000000002';
  participant_b_booking_id uuid := '2f600000-0000-4000-8000-000000000003';
  contract_row public.member_plan_contracts%rowtype;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'three-member-contract-manager@test.local',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'THREE MEMBER CONTRACT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'THREE MEMBER TEST BRANCH', 'THREE-MEMBER', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active
  ) values (
    manager_id, tenant_id, branch_id, 'manager', 'Three Member Manager', true
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, status, is_prospect, member_code
  ) values
    (owner_member_id, tenant_id, branch_id, 'Shared Owner', '0919900001', 'active', false, 'E990001'),
    (participant_a_id, tenant_id, branch_id, 'Shared Participant A', '0919900002', 'active', false, 'E990002'),
    (participant_b_id, tenant_id, branch_id, 'Shared Participant B', '0919900003', 'active', false, 'E990003'),
    (unrelated_member_id, tenant_id, branch_id, 'Unrelated Member', '0919900004', 'active', false, 'E990004');

  insert into public.bige_member_legacy_numbers (
    tenant_id, member_id, legacy_number, source
  ) values
    (tenant_id, owner_member_id, '990', 'regression_test'),
    (tenant_id, participant_a_id, '990', 'regression_test'),
    (tenant_id, participant_b_id, '990', 'regression_test');

  if (
    select count(distinct legacy.member_id)
    from public.bige_member_legacy_numbers legacy
    where legacy.tenant_id = test_block.tenant_id
      and legacy.legacy_number = '990'
  ) <> 3 then
    raise exception 'three formal members should share one legacy number';
  end if;

  begin
    insert into public.bige_member_legacy_numbers (
      tenant_id, member_id, legacy_number, source
    ) values (
      tenant_id, unrelated_member_id, '990', 'regression_test'
    );
    raise exception 'a fourth member should not share the legacy number';
  exception
    when others then
      if sqlerrm <> 'legacy_number_share_limit_exceeded' then
        raise;
      end if;
  end;

  insert into public.member_plan_contracts (
    id,
    tenant_id,
    branch_id,
    member_id,
    contract_number,
    status,
    starts_at,
    ends_at,
    total_sessions,
    unlocked_sessions,
    used_sessions,
    remaining_sessions,
    course_allocations,
    course_used,
    course_allocations_configured_at
  ) values (
    contract_id,
    tenant_id,
    branch_id,
    owner_member_id,
    'THREE-MEMBER-TEST-001',
    'active',
    now() - interval '1 day',
    now() + interval '1 year',
    6,
    6,
    0,
    6,
    '{"weight_training":3,"relaxation":0,"reformer_pilates":3,"sports_cupping":0,"fascia_knife":0}'::jsonb,
    '{"weight_training":0,"relaxation":0,"reformer_pilates":0,"sports_cupping":0,"fascia_knife":0}'::jsonb,
    now()
  );

  insert into public.member_plan_contract_members (
    tenant_id, contract_id, member_id, relationship, created_by
  ) values
    (tenant_id, contract_id, participant_a_id, 'participant', manager_id),
    (tenant_id, contract_id, participant_b_id, 'participant', manager_id);

  if (
    select count(*)
    from public.member_plan_contract_members contract_member
    where contract_member.contract_id = test_block.contract_id
  ) <> 3 then
    raise exception 'contract should have one owner and two participants';
  end if;

  if not public.bige_member_can_use_contract(contract_id, owner_member_id, tenant_id)
     or not public.bige_member_can_use_contract(contract_id, participant_a_id, tenant_id)
     or not public.bige_member_can_use_contract(contract_id, participant_b_id, tenant_id)
     or public.bige_member_can_use_contract(contract_id, unrelated_member_id, tenant_id) then
    raise exception 'shared contract eligibility does not match its three members';
  end if;

  insert into public.bookings (
    id,
    tenant_id,
    branch_id,
    member_id,
    service_name,
    starts_at,
    ends_at,
    status,
    is_bige_schedule,
    operation_kind,
    course_type,
    member_plan_contract_id
  ) values
    (
      owner_booking_id, tenant_id, branch_id, owner_member_id,
      'Weight Training', now() - interval '3 hours', now() - interval '2 hours',
      'booked', true, 'pt', 'weight_training', contract_id
    ),
    (
      participant_a_booking_id, tenant_id, branch_id, participant_a_id,
      'Reformer Pilates', now() - interval '2 hours', now() - interval '1 hour',
      'booked', true, 'pt', 'reformer_pilates', contract_id
    ),
    (
      participant_b_booking_id, tenant_id, branch_id, participant_b_id,
      'Weight Training', now() - interval '1 hour', now(),
      'booked', true, 'pt', 'weight_training', contract_id
    );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform public.bige_complete_schedule_booking_without_pin(owner_booking_id);
  perform public.bige_complete_schedule_booking_without_pin(participant_a_booking_id);
  perform public.bige_complete_schedule_booking_without_pin(participant_b_booking_id);

  select * into contract_row
  from public.member_plan_contracts
  where id = contract_id;

  if contract_row.used_sessions <> 3
     or contract_row.remaining_sessions <> 3
     or coalesce((contract_row.course_used->>'weight_training')::integer, 0) <> 2
     or coalesce((contract_row.course_used->>'reformer_pilates')::integer, 0) <> 1 then
    raise exception 'three members did not deduct the same contract and course quotas';
  end if;

  if (
    select count(*)
    from public.session_redemptions redemption
    where redemption.member_plan_contract_id = test_block.contract_id
      and redemption.member_id in (
        owner_member_id,
        participant_a_id,
        participant_b_id
      )
  ) <> 3 then
    raise exception 'each attendee should retain an individual redemption on the shared contract';
  end if;

  perform public.bige_restore_completed_schedule_booking(participant_a_booking_id);

  select * into contract_row
  from public.member_plan_contracts
  where id = contract_id;

  if contract_row.used_sessions <> 2
     or contract_row.remaining_sessions <> 4
     or coalesce((contract_row.course_used->>'weight_training')::integer, 0) <> 2
     or coalesce((contract_row.course_used->>'reformer_pilates')::integer, 0) <> 0 then
    raise exception 'restoring one participant should restore the shared contract quota once';
  end if;
end;
$$;

rollback;
