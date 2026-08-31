-- Read-only regression check for the legacy member number 79 shared contract.
do $$
#variable_conflict use_variable
declare
  target_tenant_id uuid;
  target_contract_id uuid;
begin
  select member.tenant_id
  into target_tenant_id
  from public.bige_member_legacy_numbers legacy
  join public.members member on member.id = legacy.member_id
  where legacy.legacy_number = '79'
    and member.full_name = '鄭弘憶';

  select contract.id
  into target_contract_id
  from public.member_plan_contracts contract
  where contract.tenant_id = target_tenant_id
    and contract.contract_number = 'LEGACY-79-01';

  if target_contract_id is null then
    raise exception 'legacy 79 shared contract is missing';
  end if;

  if (
    select count(*)
    from public.member_plan_contract_members contract_member
    join public.bige_member_legacy_numbers legacy
      on legacy.member_id = contract_member.member_id
     and legacy.tenant_id = contract_member.tenant_id
     and legacy.legacy_number = '79'
    where contract_member.contract_id = target_contract_id
  ) <> 3 then
    raise exception 'legacy 79 contract must include all three shared members';
  end if;

  if not exists (
    select 1
    from public.member_plan_contract_members contract_member
    join public.members member on member.id = contract_member.member_id
    where contract_member.contract_id = target_contract_id
      and member.full_name = '孫馧婷'
      and contract_member.relationship = 'owner'
  )
    or (
      select count(*)
      from public.member_plan_contract_members contract_member
      join public.members member on member.id = contract_member.member_id
      where contract_member.contract_id = target_contract_id
        and member.full_name in ('鄭宏憶', '鄭弘憶')
        and contract_member.relationship = 'participant'
    ) <> 2
  then
    raise exception 'legacy 79 owner or participant relationships drifted';
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
    raise exception 'a legacy 79 member cannot use the shared contract';
  end if;
end;
$$;
