begin;

do $$
#variable_conflict use_variable
declare
  target_tenant_id uuid;
  target_contract_id uuid;
  target_member_id uuid;
  remaining_sessions_before integer;
  unlocked_sessions_before integer;
  used_sessions_before integer;
  redemption_count_before bigint;
  inserted_count integer;
begin
  if (
    select count(distinct legacy.member_id)
    from public.bige_member_legacy_numbers legacy
    join public.members member on member.id = legacy.member_id
    where legacy.legacy_number = '79'
      and member.full_name in ('孫馧婷', '鄭宏憶', '鄭弘憶')
  ) <> 3
    or exists (
      select 1
      from public.bige_member_legacy_numbers legacy
      join public.members member on member.id = legacy.member_id
      where legacy.legacy_number = '79'
        and member.full_name not in ('孫馧婷', '鄭宏憶', '鄭弘憶')
    )
  then
    raise exception 'legacy_79_member_group_precondition_failed';
  end if;

  select member.id, member.tenant_id
  into target_member_id, target_tenant_id
  from public.bige_member_legacy_numbers legacy
  join public.members member on member.id = legacy.member_id
  where legacy.legacy_number = '79'
    and member.full_name = '鄭弘憶';

  if target_member_id is null or target_tenant_id is null then
    raise exception 'legacy_79_zheng_hongyi_not_found';
  end if;

  if (
    select count(*)
    from public.member_plan_contracts contract
    where contract.tenant_id = target_tenant_id
      and contract.contract_number = 'LEGACY-79-01'
  ) <> 1 then
    raise exception 'legacy_79_contract_precondition_failed';
  end if;

  select
    contract.id,
    contract.remaining_sessions,
    contract.unlocked_sessions,
    contract.used_sessions
  into
    target_contract_id,
    remaining_sessions_before,
    unlocked_sessions_before,
    used_sessions_before
  from public.member_plan_contracts contract
  where contract.tenant_id = target_tenant_id
    and contract.contract_number = 'LEGACY-79-01'
    and contract.status = 'active'
    and contract.is_legacy_import = true;

  if target_contract_id is null then
    raise exception 'legacy_79_active_contract_not_found';
  end if;

  if not exists (
    select 1
    from public.member_plan_contract_members contract_member
    join public.members member on member.id = contract_member.member_id
    where contract_member.contract_id = target_contract_id
      and contract_member.tenant_id = target_tenant_id
      and member.full_name = '孫馧婷'
      and contract_member.relationship = 'owner'
  )
    or not exists (
      select 1
      from public.member_plan_contract_members contract_member
      join public.members member on member.id = contract_member.member_id
      where contract_member.contract_id = target_contract_id
        and contract_member.tenant_id = target_tenant_id
        and member.full_name = '鄭宏憶'
        and contract_member.relationship = 'participant'
    )
  then
    raise exception 'legacy_79_existing_contract_members_precondition_failed';
  end if;

  if exists (
    select 1
    from public.member_plan_contract_members contract_member
    join public.members member on member.id = contract_member.member_id
    where contract_member.contract_id = target_contract_id
      and member.full_name not in ('孫馧婷', '鄭宏憶', '鄭弘憶')
  ) then
    raise exception 'legacy_79_unexpected_contract_member';
  end if;

  select count(*)
  into redemption_count_before
  from public.session_redemptions redemption
  where redemption.member_plan_contract_id = target_contract_id;

  insert into public.member_plan_contract_members (
    tenant_id,
    contract_id,
    member_id,
    relationship
  ) values (
    target_tenant_id,
    target_contract_id,
    target_member_id,
    'participant'
  )
  on conflict (contract_id, member_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count not in (0, 1) then
    raise exception 'legacy_79_shared_member_insert_failed';
  end if;

  if (
    select count(*)
    from public.member_plan_contract_members contract_member
    where contract_member.contract_id = target_contract_id
      and contract_member.tenant_id = target_tenant_id
  ) <> 3
    or (
      select count(*)
      from public.member_plan_contract_members contract_member
      join public.bige_member_legacy_numbers legacy
        on legacy.member_id = contract_member.member_id
       and legacy.tenant_id = contract_member.tenant_id
       and legacy.legacy_number = '79'
      where contract_member.contract_id = target_contract_id
    ) <> 3
    or not exists (
      select 1
      from public.member_plan_contract_members contract_member
      where contract_member.contract_id = target_contract_id
        and contract_member.member_id = target_member_id
        and contract_member.relationship = 'participant'
    )
  then
    raise exception 'legacy_79_shared_contract_verification_failed';
  end if;

  if exists (
    select 1
    from public.bige_member_legacy_numbers legacy
    where legacy.tenant_id = target_tenant_id
      and legacy.legacy_number = '79'
      and not public.bige_member_can_use_contract(
        target_contract_id,
        legacy.member_id,
        target_tenant_id
      )
  ) then
    raise exception 'legacy_79_contract_eligibility_verification_failed';
  end if;

  if not exists (
    select 1
    from public.member_plan_contracts contract
    where contract.id = target_contract_id
      and contract.remaining_sessions is not distinct from remaining_sessions_before
      and contract.unlocked_sessions is not distinct from unlocked_sessions_before
      and contract.used_sessions is not distinct from used_sessions_before
  )
    or (
      select count(*)
      from public.session_redemptions redemption
      where redemption.member_plan_contract_id = target_contract_id
    ) <> redemption_count_before
  then
    raise exception 'legacy_79_migration_must_not_deduct_sessions';
  end if;
end;
$$;

commit;
