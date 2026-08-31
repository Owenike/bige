begin;

do $$
#variable_conflict use_variable
declare
  target_tenant_id uuid;
  target_contract_id uuid;
  canonical_member_id uuid;
  duplicate_member_id uuid;
  remaining_sessions_before integer;
  unlocked_sessions_before integer;
  used_sessions_before integer;
  redemption_count_before bigint;
  affected_count integer;
begin
  select member.id, member.tenant_id
  into canonical_member_id, target_tenant_id
  from public.bige_member_legacy_numbers legacy
  join public.members member on member.id = legacy.member_id
  where legacy.legacy_number = '79'
    and member.full_name = '鄭宏憶';

  select member.id
  into duplicate_member_id
  from public.bige_member_legacy_numbers legacy
  join public.members member on member.id = legacy.member_id
  where legacy.legacy_number = '79'
    and member.full_name = '鄭弘憶'
    and member.tenant_id = target_tenant_id;

  if canonical_member_id is null
    or duplicate_member_id is null
    or target_tenant_id is null
    or canonical_member_id = duplicate_member_id
  then
    raise exception 'legacy_79_identity_merge_precondition_failed';
  end if;

  if not exists (
    select 1
    from public.members duplicate
    where duplicate.id = duplicate_member_id
      and duplicate.tenant_id = target_tenant_id
      and duplicate.full_name = '鄭弘憶'
      and duplicate.phone_normalized is null
      and duplicate.birth_date is null
      and duplicate.email is null
      and duplicate.auth_user_id is null
  ) then
    raise exception 'legacy_79_duplicate_member_profile_changed';
  end if;

  if (
    select count(*)
    from public.bookings booking
    where booking.member_id = duplicate_member_id
  ) <> 2
    or (
      select count(*)
      from public.session_redemptions redemption
      where redemption.member_id = duplicate_member_id
    ) <> 1
    or (
      select count(*)
      from public.notification_deliveries delivery
      where delivery.member_id = duplicate_member_id
    ) <> 1
    or (
      select count(*)
      from public.member_plan_contract_members contract_member
      where contract_member.member_id = duplicate_member_id
    ) <> 1
    or (
      select count(*)
      from public.bige_member_legacy_numbers legacy
      where legacy.member_id = duplicate_member_id
    ) <> 1
  then
    raise exception 'legacy_79_duplicate_reference_counts_changed';
  end if;

  if exists (
    select 1
    from public.bookings duplicate_booking
    join public.bookings canonical_booking
      on canonical_booking.tenant_id = duplicate_booking.tenant_id
     and canonical_booking.member_id = canonical_member_id
     and canonical_booking.id <> duplicate_booking.id
     and canonical_booking.status not in ('cancelled', 'no_show')
     and duplicate_booking.status not in ('cancelled', 'no_show')
     and canonical_booking.starts_at < duplicate_booking.ends_at
     and canonical_booking.ends_at > duplicate_booking.starts_at
    where duplicate_booking.member_id = duplicate_member_id
  ) then
    raise exception 'legacy_79_booking_merge_conflict';
  end if;

  if (
    select count(*)
    from public.member_plan_contracts contract
    where contract.tenant_id = target_tenant_id
      and contract.contract_number = 'LEGACY-79-01'
      and contract.status = 'active'
      and contract.is_legacy_import = true
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
    and contract.contract_number = 'LEGACY-79-01';

  select count(*)
  into redemption_count_before
  from public.session_redemptions redemption
  where redemption.member_plan_contract_id = target_contract_id;

  if not public.bige_member_can_use_contract(
    target_contract_id,
    canonical_member_id,
    target_tenant_id
  )
    or not public.bige_member_can_use_contract(
      target_contract_id,
      duplicate_member_id,
      target_tenant_id
    )
  then
    raise exception 'legacy_79_contract_membership_precondition_failed';
  end if;

  update public.bookings
  set member_id = canonical_member_id
  where member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 2 then
    raise exception 'legacy_79_booking_merge_failed';
  end if;

  update public.session_redemptions
  set member_id = canonical_member_id
  where member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'legacy_79_redemption_merge_failed';
  end if;

  update public.notification_deliveries
  set member_id = canonical_member_id
  where member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'legacy_79_notification_merge_failed';
  end if;

  delete from public.member_plan_contract_members
  where contract_id = target_contract_id
    and member_id = duplicate_member_id
    and relationship = 'participant';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'legacy_79_duplicate_contract_membership_delete_failed';
  end if;

  delete from public.bige_member_legacy_numbers
  where tenant_id = target_tenant_id
    and member_id = duplicate_member_id
    and legacy_number = '79';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'legacy_79_duplicate_number_delete_failed';
  end if;

  delete from public.members
  where id = duplicate_member_id
    and tenant_id = target_tenant_id
    and full_name = '鄭弘憶';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'legacy_79_duplicate_member_delete_failed';
  end if;

  if exists (select 1 from public.members where id = duplicate_member_id)
    or exists (select 1 from public.bookings where member_id = duplicate_member_id)
    or exists (select 1 from public.session_redemptions where member_id = duplicate_member_id)
    or exists (select 1 from public.notification_deliveries where member_id = duplicate_member_id)
    or exists (select 1 from public.member_plan_contract_members where member_id = duplicate_member_id)
    or exists (select 1 from public.bige_member_legacy_numbers where member_id = duplicate_member_id)
  then
    raise exception 'legacy_79_duplicate_member_cleanup_failed';
  end if;

  if (
    select count(distinct legacy.member_id)
    from public.bige_member_legacy_numbers legacy
    join public.members member on member.id = legacy.member_id
    where legacy.tenant_id = target_tenant_id
      and legacy.legacy_number = '79'
      and member.full_name in ('孫馧婷', '鄭宏憶')
  ) <> 2
    or exists (
      select 1
      from public.bige_member_legacy_numbers legacy
      join public.members member on member.id = legacy.member_id
      where legacy.tenant_id = target_tenant_id
        and legacy.legacy_number = '79'
        and member.full_name not in ('孫馧婷', '鄭宏憶')
    )
  then
    raise exception 'legacy_79_canonical_group_verification_failed';
  end if;

  if (
    select count(*)
    from public.member_plan_contract_members contract_member
    join public.bige_member_legacy_numbers legacy
      on legacy.member_id = contract_member.member_id
     and legacy.tenant_id = contract_member.tenant_id
     and legacy.legacy_number = '79'
    where contract_member.contract_id = target_contract_id
  ) <> 2
    or not public.bige_member_can_use_contract(
      target_contract_id,
      canonical_member_id,
      target_tenant_id
    )
  then
    raise exception 'legacy_79_shared_contract_verification_failed';
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
    raise exception 'legacy_79_completed_booking_identity_verification_failed';
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
    raise exception 'legacy_79_identity_merge_must_not_change_deduction';
  end if;
end;
$$;

commit;
