-- Production data-correction regression check for migration 20260831132918.
-- This is intentionally read-only and raises if the corrected identity drifts.
do $$
#variable_conflict use_variable
declare
  duplicate_member_id constant uuid := '47f6f69d-aea8-492e-8cfb-b2ca7bfeb034';
  canonical_member_id constant uuid := 'a79c69a8-0d7a-493e-be7a-f85d814acffa';
  fa_booking_id constant uuid := '4a2196a4-37d6-435f-80bb-1ddb257ef39b';
  trial_booking_id constant uuid := '4741b028-2a3d-492e-b744-a2ed61659f59';
  contract_id constant uuid := '4351f6ab-e77d-4ff4-9d7e-6d3915ace78d';
begin
  if not exists (
    select 1
    from public.members
    where id = canonical_member_id
      and full_name = '鄭美惠'
      and member_code = 'E000090'
      and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 4) = '1137'
  ) then
    raise exception 'corrected canonical member is missing';
  end if;

  if exists (select 1 from public.members where id = duplicate_member_id) then
    raise exception 'incorrect duplicate member still exists';
  end if;

  if not exists (
    select 1
    from public.bookings booking
    join public.trial_bookings trial
      on trial.id = booking.trial_booking_id
    join public.member_plan_contracts contract
      on contract.id = booking.converted_contract_id
    where booking.id = fa_booking_id
      and booking.member_id = canonical_member_id
      and booking.trial_conversion_outcome = 'converted'
      and (booking.starts_at at time zone 'Asia/Taipei')::date = date '2026-08-03'
      and trial.id = trial_booking_id
      and trial.member_id = canonical_member_id
      and trial.name = '鄭美惠'
      and contract.id = contract_id
      and contract.member_id = canonical_member_id
      and contract.signed_on = date '2026-08-03'
  ) then
    raise exception 'corrected FA booking, trial, or contract identity drifted';
  end if;

  if (select count(*) from public.member_plan_contract_members contract_member where contract_member.contract_id = contract_id and contract_member.member_id = canonical_member_id and contract_member.relationship = 'owner') <> 1
    or (select count(*) from public.member_plan_ledger ledger where ledger.contract_id = contract_id and ledger.member_id = canonical_member_id) <> 1
    or (select count(*) from public.staff_sales_events where member_id = canonical_member_id and business_date = date '2026-08-03' and source_type = 'fa') <> 1
  then
    raise exception 'corrected FA contract or sales references drifted';
  end if;
end;
$$;
