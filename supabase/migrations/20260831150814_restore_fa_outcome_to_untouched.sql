begin;

-- Managers can correct an FA that was accidentally completed as not converted
-- without deleting the appointment. The booking, FA fee attribution, and the
-- matching CRM trial result are restored together so no partial state remains.
create or replace function public.bige_restore_fa_no_sale_v1(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_row public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  previous_payload jsonb;
begin
  select profile.* into actor_row
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.is_active = true;

  if not found or not public.bige_profile_can_manage_schedule(actor_row) then
    raise exception 'forbidden';
  end if;

  select booking.* into booking_row
  from public.bookings booking
  where booking.id = p_booking_id
    and booking.is_bige_schedule = true
    and booking.operation_kind = 'trial'
  for update;

  if not found then
    raise exception 'trial_booking_not_found';
  end if;

  if actor_row.role <> 'platform_admin'
     and actor_row.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if booking_row.converted_at is not null
     or booking_row.converted_contract_id is not null
     or booking_row.status <> 'completed'
     or booking_row.trial_conversion_outcome <> 'not_converted' then
    raise exception 'fa_no_sale_restore_not_available';
  end if;

  previous_payload := jsonb_build_object(
    'trialBookingId', booking_row.trial_booking_id,
    'memberId', booking_row.member_id,
    'previousFaFeeAmount', booking_row.fa_fee_amount,
    'previousFaFeeRecipientProfileId', booking_row.fa_fee_recipient_profile_id,
    'previousFaFeeRecipientName', booking_row.fa_fee_recipient_name,
    'previousStatus', booking_row.status,
    'previousTrialConversionOutcome', booking_row.trial_conversion_outcome
  );

  update public.bookings
  set status = 'booked',
      operation_result = null,
      trial_conversion_outcome = null,
      completed_at = null,
      fa_fee_amount = null,
      fa_fee_recipient_profile_id = null,
      fa_fee_recipient_name = null,
      fa_fee_recorded_by = null,
      fa_fee_recorded_at = null,
      status_reason = 'fa_no_sale_restored',
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id
  returning * into booking_row;

  update public.crm_leads lead
  set status = 'trial_booked',
      trial_status = 'scheduled',
      trial_result = null,
      lost_reason = null,
      won_member_id = null,
      won_plan_code = null,
      updated_by = actor_row.id,
      updated_at = now()
  where lead.tenant_id = booking_row.tenant_id
    and lead.trial_booking_id = booking_row.trial_booking_id
    and lead.status = 'lost'
    and lead.trial_status = 'attended'
    and lead.trial_result = 'lost'
    and lead.lost_reason = 'fa_not_converted';

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  ) values (
    booking_row.tenant_id,
    actor_row.id,
    'bige_fa_no_sale_restored',
    'booking',
    booking_row.id::text,
    'manager_correction',
    previous_payload
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', booking_row.status,
    'operationResult', booking_row.operation_result,
    'trialConversionOutcome', booking_row.trial_conversion_outcome,
    'restored', true
  );
end;
$$;

revoke all on function public.bige_restore_fa_no_sale_v1(uuid)
  from public, anon;
grant execute on function public.bige_restore_fa_no_sale_v1(uuid)
  to authenticated, service_role;

commit;
