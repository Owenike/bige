-- Read-only regression check for the corrected legacy member number 79 shared contract.
do $$
#variable_conflict use_variable
declare
  target_tenant_id uuid;
  target_contract_id uuid;
  canonical_member_id uuid;
begin
  select member.id, member.tenant_id
  into canonical_member_id, target_tenant_id
  from public.bige_member_legacy_numbers legacy
  join public.members member on member.id = legacy.member_id
  where legacy.legacy_number = '79'
    and member.full_name = '鄭宏憶';

  select contract.id
  into target_contract_id
  from public.member_plan_contracts contract
  where contract.tenant_id = target_tenant_id
    and contract.contract_number = 'LEGACY-79-01';

  if target_contract_id is null then
    raise exception 'legacy 79 shared contract is missing';
  end if;

  if exists (
    select 1
    from public.members member
    where member.full_name = '鄭弘憶'
      and member.tenant_id = target_tenant_id
  ) then
    raise exception 'misspelled legacy 79 member still exists';
  end if;

  if (
    select count(distinct legacy.member_id)
    from public.bige_member_legacy_numbers legacy
    join public.members member on member.id = legacy.member_id
    where legacy.tenant_id = target_tenant_id
      and legacy.legacy_number = '79'
      and member.full_name in ('孫馧婷', '鄭宏憶')
  ) <> 2 then
    raise exception 'legacy 79 must resolve to the two real shared members';
  end if;

  if not exists (
    select 1
    from public.member_plan_contract_members contract_member
    join public.members member on member.id = contract_member.member_id
    where contract_member.contract_id = target_contract_id
      and member.full_name = '孫馧婷'
      and contract_member.relationship = 'owner'
  )
    or not exists (
      select 1
      from public.member_plan_contract_members contract_member
      join public.members member on member.id = contract_member.member_id
      where contract_member.contract_id = target_contract_id
        and member.full_name = '鄭宏憶'
        and contract_member.relationship = 'participant'
    )
  then
    raise exception 'legacy 79 owner or participant relationship drifted';
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

  if not exists (
    select 1
    from public.bookings booking
    join public.session_redemptions redemption
      on redemption.booking_id = booking.id
     and redemption.member_id = canonical_member_id
    where booking.member_id = canonical_member_id
      and booking.status = 'completed'
      and booking.operation_result = 'completed'
      and booking.course_type = 'reformer_pilates'
      and (booking.starts_at at time zone 'Asia/Taipei') = timestamp '2026-08-22 22:00:00'
  ) then
    raise exception 'completed August 22 class is not assigned to the canonical member';
  end if;
end;
$$;
