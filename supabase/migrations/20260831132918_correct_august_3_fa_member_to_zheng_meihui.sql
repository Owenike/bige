begin;

do $$
#variable_conflict use_variable
declare
  target_tenant_id constant uuid := '3bc12d76-e8b6-4dd0-a87d-2048b495ff0c';
  duplicate_member_id constant uuid := '47f6f69d-aea8-492e-8cfb-b2ca7bfeb034';
  canonical_member_id constant uuid := 'a79c69a8-0d7a-493e-be7a-f85d814acffa';
  fa_booking_id constant uuid := '4a2196a4-37d6-435f-80bb-1ddb257ef39b';
  trial_booking_id constant uuid := '4741b028-2a3d-492e-b744-a2ed61659f59';
  contract_id constant uuid := '4351f6ab-e77d-4ff4-9d7e-6d3915ace78d';
  affected_count integer;
begin
  if not exists (
    select 1
    from public.members canonical
    join public.trial_bookings trial
      on trial.id = trial_booking_id
    where canonical.id = canonical_member_id
      and canonical.tenant_id = target_tenant_id
      and canonical.full_name = '鄭美惠'
      and canonical.member_code = 'E000090'
      and canonical.status = 'active'
      and regexp_replace(coalesce(canonical.phone, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(canonical.phone, ''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(trial.phone, ''), '[^0-9]', '', 'g')
  ) then
    raise exception 'august_3_fa_canonical_member_precondition_failed';
  end if;

  if not exists (
    select 1
    from public.members duplicate
    where duplicate.id = duplicate_member_id
      and duplicate.tenant_id = target_tenant_id
      and duplicate.full_name = '陳小姐'
      and duplicate.member_code = 'E000177'
      and coalesce(regexp_replace(duplicate.phone, '[^0-9]', '', 'g'), '') = ''
      and duplicate.auth_user_id is null
  ) then
    raise exception 'august_3_fa_duplicate_member_precondition_failed';
  end if;

  if not exists (
    select 1
    from public.bookings booking
    join public.trial_bookings trial
      on trial.id = booking.trial_booking_id
    join public.member_plan_contracts contract
      on contract.id = booking.converted_contract_id
    where booking.id = fa_booking_id
      and booking.tenant_id = target_tenant_id
      and booking.member_id = duplicate_member_id
      and booking.is_bige_schedule = true
      and booking.operation_kind = 'trial'
      and booking.trial_stage = 'FA1'
      and booking.status = 'completed'
      and booking.trial_conversion_outcome = 'converted'
      and (booking.starts_at at time zone 'Asia/Taipei')::date = date '2026-08-03'
      and trial.id = trial_booking_id
      and trial.member_id = duplicate_member_id
      and trial.name = '陳小姐'
      and trial.appointment_date = date '2026-08-03'
      and contract.id = contract_id
      and contract.tenant_id = target_tenant_id
      and contract.member_id = duplicate_member_id
      and contract.converted_from_booking_id = booking.id
      and contract.signed_on = date '2026-08-03'
  ) then
    raise exception 'august_3_fa_conversion_precondition_failed';
  end if;

  if (select count(*) from public.bookings where member_id = duplicate_member_id) <> 1
    or (select count(*) from public.trial_bookings where member_id = duplicate_member_id) <> 1
    or (select count(*) from public.member_plan_contracts where member_id = duplicate_member_id) <> 1
    or (select count(*) from public.member_plan_contract_members where member_id = duplicate_member_id) <> 1
    or (select count(*) from public.member_plan_ledger where member_id = duplicate_member_id) <> 1
    or (select count(*) from public.staff_sales_events where member_id = duplicate_member_id) <> 1
  then
    raise exception 'august_3_fa_expected_reference_counts_changed';
  end if;

  if exists (select 1 from public.bige_line_group_binding_members where member_id = duplicate_member_id)
    or exists (select 1 from public.bige_line_group_bindings where member_id = duplicate_member_id)
    or exists (select 1 from public.bige_line_schedule_notifications where member_id = duplicate_member_id)
    or exists (select 1 from public.bige_member_legacy_numbers where member_id = duplicate_member_id)
    or exists (select 1 from public.bige_walk_in_payment_operations where member_id = duplicate_member_id)
    or exists (select 1 from public.booking_package_logs where member_id = duplicate_member_id)
    or exists (select 1 from public.booking_waitlist where member_id = duplicate_member_id)
    or exists (select 1 from public.checkins where member_id = duplicate_member_id)
    or exists (select 1 from public.crm_leads where won_member_id = duplicate_member_id)
    or exists (select 1 from public.crm_opportunities where member_id = duplicate_member_id)
    or exists (select 1 from public.entry_passes where member_id = duplicate_member_id)
    or exists (select 1 from public.frontdesk_incidents where member_id = duplicate_member_id)
    or exists (select 1 from public.frontdesk_locker_rentals where member_id = duplicate_member_id)
    or exists (select 1 from public.member_activation_tokens where member_id = duplicate_member_id)
    or exists (select 1 from public.member_device_sessions where member_id = duplicate_member_id)
    or exists (select 1 from public.member_identities where member_id = duplicate_member_id)
    or exists (select 1 from public.member_notification_reads where member_id = duplicate_member_id)
    or exists (select 1 from public.member_progress_entries where member_id = duplicate_member_id)
    or exists (select 1 from public.member_progress_events where member_id = duplicate_member_id)
    or exists (select 1 from public.notification_deliveries where member_id = duplicate_member_id)
    or exists (select 1 from public.notification_logs where member_id = duplicate_member_id)
    or exists (select 1 from public.orders where member_id = duplicate_member_id)
    or exists (select 1 from public.qr_token_uses where member_id = duplicate_member_id)
    or exists (select 1 from public.session_redemptions where member_id = duplicate_member_id)
    or exists (select 1 from public.student_checkin_member_links where member_id = duplicate_member_id)
    or exists (select 1 from public.subscriptions where member_id = duplicate_member_id)
  then
    raise exception 'august_3_fa_duplicate_member_has_unexpected_references';
  end if;

  if exists (
    select 1
    from public.member_plan_contract_members contract_member
    where contract_member.contract_id = contract_id
      and contract_member.member_id = canonical_member_id
  ) then
    raise exception 'august_3_fa_contract_member_already_merged';
  end if;

  update public.trial_bookings
  set name = '鄭美惠',
      member_id = canonical_member_id,
      updated_at = now()
  where id = trial_booking_id
    and member_id = duplicate_member_id
    and name = '陳小姐';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_trial_booking_update_failed';
  end if;

  update public.bookings
  set member_id = canonical_member_id,
      updated_at = now()
  where id = fa_booking_id
    and member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_booking_update_failed';
  end if;

  update public.member_plan_contracts
  set member_id = canonical_member_id,
      updated_at = now()
  where id = contract_id
    and member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_contract_update_failed';
  end if;

  update public.member_plan_ledger ledger
  set member_id = canonical_member_id
  where ledger.contract_id = contract_id
    and ledger.member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_ledger_update_failed';
  end if;

  update public.staff_sales_events
  set member_id = canonical_member_id,
      updated_at = now()
  where member_id = duplicate_member_id;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_sales_event_update_failed';
  end if;

  delete from public.members
  where id = duplicate_member_id
    and tenant_id = target_tenant_id
    and full_name = '陳小姐'
    and member_code = 'E000177';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'august_3_fa_duplicate_member_delete_failed';
  end if;

  if exists (select 1 from public.members where id = duplicate_member_id)
    or exists (select 1 from public.bookings where member_id = duplicate_member_id)
    or exists (select 1 from public.trial_bookings where member_id = duplicate_member_id)
    or exists (select 1 from public.member_plan_contracts where member_id = duplicate_member_id)
    or exists (select 1 from public.member_plan_contract_members where member_id = duplicate_member_id)
    or exists (select 1 from public.member_plan_ledger where member_id = duplicate_member_id)
    or exists (select 1 from public.staff_sales_events where member_id = duplicate_member_id)
  then
    raise exception 'august_3_fa_duplicate_member_cleanup_failed';
  end if;

  if not exists (
    select 1
    from public.bookings booking
    join public.trial_bookings trial
      on trial.id = booking.trial_booking_id
    join public.member_plan_contracts contract
      on contract.id = booking.converted_contract_id
    join public.member_plan_contract_members contract_member
      on contract_member.contract_id = contract.id
     and contract_member.member_id = canonical_member_id
     and contract_member.relationship = 'owner'
    where booking.id = fa_booking_id
      and booking.member_id = canonical_member_id
      and trial.id = trial_booking_id
      and trial.member_id = canonical_member_id
      and trial.name = '鄭美惠'
      and contract.id = contract_id
      and contract.member_id = canonical_member_id
  )
    or not exists (
      select 1
      from public.member_plan_ledger ledger
      where ledger.contract_id = contract_id
        and ledger.member_id = canonical_member_id
    )
    or not exists (
      select 1
      from public.staff_sales_events
      where member_id = canonical_member_id
        and business_date = date '2026-08-03'
        and source_type = 'fa'
    )
  then
    raise exception 'august_3_fa_member_correction_verification_failed';
  end if;
end;
$$;

commit;
