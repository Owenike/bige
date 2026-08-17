begin;

create or replace function public.bige_change_fa_conversion_payment(
  p_booking_id uuid,
  p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  payment_row public.bige_contract_payments%rowtype;
  other_paid bigint := 0;
  total_paid bigint := 0;
  minimum_deposit bigint := 0;
  next_unlocked integer := 0;
  next_remaining integer := 0;
  unlock_delta integer := 0;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
    and operation_kind = 'trial'
  for update;

  if not found then
    raise exception 'trial_booking_not_found';
  end if;

  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if not (
    actor.role = 'platform_admin'
    or actor.role = 'frontdesk'
    or (
      actor.department = 'coaching'
      and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
    )
  ) then
    raise exception 'forbidden';
  end if;

  if booking_row.converted_at is null or booking_row.converted_contract_id is null then
    raise exception 'fa_conversion_not_found';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = booking_row.converted_contract_id
    and tenant_id = booking_row.tenant_id
    and converted_from_booking_id = booking_row.id
  for update;

  if not found or contract_row.status = 'canceled' then
    raise exception 'fa_conversion_contract_not_editable';
  end if;

  if p_amount <= 0 or p_amount > coalesce(contract_row.total_amount, 0) then
    raise exception 'fa_conversion_payment_amount_invalid';
  end if;

  minimum_deposit := ceil(
    contract_row.total_amount::numeric / nullif(contract_row.total_sessions, 0)
  )::bigint;
  if p_amount < minimum_deposit then
    raise exception 'minimum_deposit_not_met';
  end if;

  select * into payment_row
  from public.bige_contract_payments
  where tenant_id = booking_row.tenant_id
    and contract_id = contract_row.id
    and idempotency_key = 'contract-create:' || contract_row.id::text
  for update;

  if not found or payment_row.status <> 'recorded' then
    raise exception 'fa_conversion_initial_payment_not_editable';
  end if;

  select coalesce(sum(amount), 0)::bigint into other_paid
  from public.bige_contract_payments
  where tenant_id = booking_row.tenant_id
    and contract_id = contract_row.id
    and status = 'recorded'
    and id <> payment_row.id;

  total_paid := other_paid + p_amount;
  if total_paid > contract_row.total_amount then
    raise exception 'payment_amount_exceeds_contract_balance';
  end if;

  next_unlocked := least(
    contract_row.total_sessions,
    floor(total_paid::numeric * contract_row.total_sessions / contract_row.total_amount)::integer
  );
  if next_unlocked < contract_row.used_sessions then
    raise exception 'fa_conversion_payment_below_used_sessions';
  end if;

  next_remaining := next_unlocked - contract_row.used_sessions;
  unlock_delta := next_unlocked - contract_row.unlocked_sessions;

  update public.bige_contract_payments
  set amount = p_amount,
      note = concat_ws(
        '；',
        nullif(btrim(coalesce(note, '')), ''),
        'FA 成交金額由 ' || payment_row.amount::text || ' 變更為 ' || p_amount::text
      )
  where id = payment_row.id;

  update public.member_plan_contracts
  set unlocked_sessions = next_unlocked,
      remaining_sessions = next_remaining,
      payment_status = case
        when total_paid >= total_amount then 'settled'
        when total_paid > 0 then 'deposit_paid'
        else 'unpaid'
      end,
      status = case
        when status in ('frozen', 'expired') then status
        when used_sessions >= total_sessions then 'exhausted'
        when next_remaining > 0 then 'active'
        else 'pending'
      end,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id;

  if unlock_delta <> 0 then
    insert into public.member_plan_ledger (
      tenant_id,
      branch_id,
      member_id,
      contract_id,
      source_type,
      delta_sessions,
      balance_sessions,
      reference_type,
      reference_id,
      reason,
      payload,
      created_by
    ) values (
      booking_row.tenant_id,
      contract_row.branch_id,
      contract_row.member_id,
      contract_row.id,
      'adjustment',
      unlock_delta,
      next_remaining,
      'fa_conversion_payment_correction',
      booking_row.id::text,
      'fa_conversion_payment_corrected',
      jsonb_build_object(
        'oldAmount', payment_row.amount,
        'newAmount', p_amount,
        'oldUnlockedSessions', contract_row.unlocked_sessions,
        'newUnlockedSessions', next_unlocked
      ),
      actor.id
    );
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id,
    actor.id,
    'fa_conversion_payment_changed',
    'booking',
    booking_row.id::text,
    'manager_correction',
    jsonb_build_object(
      'contractId', contract_row.id,
      'paymentId', payment_row.id,
      'oldAmount', payment_row.amount,
      'newAmount', p_amount,
      'totalPaid', total_paid,
      'unlockedSessions', next_unlocked
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'contractId', contract_row.id,
    'paymentId', payment_row.id,
    'amount', p_amount,
    'totalPaid', total_paid,
    'unlockedSessions', next_unlocked,
    'remainingSessions', next_remaining
  );
end;
$$;

revoke all on function public.bige_change_fa_conversion_payment(uuid, bigint)
  from public, anon;
grant execute on function public.bige_change_fa_conversion_payment(uuid, bigint)
  to authenticated;

create or replace function public.bige_restore_fa_conversion(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  payment_row public.bige_contract_payments%rowtype;
  payment_count integer := 0;
  dependent_count integer := 0;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
    and operation_kind = 'trial'
  for update;

  if not found then
    raise exception 'trial_booking_not_found';
  end if;

  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if not (
    actor.role = 'platform_admin'
    or upper(coalesce(actor.employee_number, '')) = 'E000001'
    or (
      actor.department = 'coaching'
      and actor.position in ('coach_manager', 'coach_city_manager')
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
    )
  ) then
    raise exception 'manager_required';
  end if;

  if booking_row.converted_at is null or booking_row.converted_contract_id is null then
    raise exception 'fa_conversion_not_found';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = booking_row.converted_contract_id
    and tenant_id = booking_row.tenant_id
    and converted_from_booking_id = booking_row.id
  for update;

  if not found or contract_row.status = 'canceled' then
    raise exception 'fa_conversion_restore_not_available';
  end if;

  if contract_row.used_sessions <> 0 then
    raise exception 'fa_conversion_has_used_sessions';
  end if;

  select count(*) into dependent_count
  from public.bookings
  where tenant_id = booking_row.tenant_id
    and member_plan_contract_id = contract_row.id
    and id <> booking_row.id;
  if dependent_count > 0 then
    raise exception 'fa_conversion_has_linked_bookings';
  end if;

  select count(*) into dependent_count
  from public.session_redemptions
  where tenant_id = booking_row.tenant_id
    and member_plan_contract_id = contract_row.id;
  if dependent_count > 0 then
    raise exception 'fa_conversion_has_redemptions';
  end if;

  select count(*) into dependent_count
  from public.bige_contract_extensions
  where tenant_id = booking_row.tenant_id
    and contract_id = contract_row.id;
  if dependent_count > 0 then
    raise exception 'fa_conversion_has_extensions';
  end if;

  select count(*) into payment_count
  from public.bige_contract_payments
  where tenant_id = booking_row.tenant_id
    and contract_id = contract_row.id;
  if payment_count > 1 then
    raise exception 'fa_conversion_has_additional_payments';
  end if;

  select * into payment_row
  from public.bige_contract_payments
  where tenant_id = booking_row.tenant_id
    and contract_id = contract_row.id
    and idempotency_key = 'contract-create:' || contract_row.id::text
  for update;

  if payment_count = 1 and (not found or payment_row.status <> 'recorded') then
    raise exception 'fa_conversion_initial_payment_not_editable';
  end if;

  if payment_row.id is not null then
    update public.bige_contract_payments
    set status = 'voided',
        voided_by = actor.id,
        voided_at = now(),
        void_reason = 'FA 成交復原'
    where id = payment_row.id;
  end if;

  if contract_row.unlocked_sessions <> 0 then
    insert into public.member_plan_ledger (
      tenant_id,
      branch_id,
      member_id,
      contract_id,
      source_type,
      delta_sessions,
      balance_sessions,
      reference_type,
      reference_id,
      reason,
      payload,
      created_by
    ) values (
      booking_row.tenant_id,
      contract_row.branch_id,
      contract_row.member_id,
      contract_row.id,
      'adjustment',
      -contract_row.unlocked_sessions,
      0,
      'fa_conversion_restore',
      booking_row.id::text,
      'fa_conversion_restored',
      jsonb_build_object(
        'contractStatus', contract_row.status,
        'paymentAmount', payment_row.amount,
        'unlockedSessions', contract_row.unlocked_sessions
      ),
      actor.id
    );
  end if;

  update public.member_plan_contracts
  set status = 'canceled',
      payment_status = case when payment_row.id is null then 'unpaid' else 'refunded' end,
      unlocked_sessions = 0,
      remaining_sessions = 0,
      note = concat_ws(
        '；',
        nullif(btrim(coalesce(note, '')), ''),
        'FA 成交已復原 ' || to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI')
      ),
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id;

  update public.bookings
  set status = 'booked',
      operation_result = null,
      trial_conversion_outcome = null,
      converted_at = null,
      converted_contract_id = null,
      completed_at = null,
      status_reason = 'fa_conversion_restored',
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id;

  update public.crm_leads
  set status = 'trial_booked',
      trial_status = 'scheduled',
      trial_result = null,
      lost_reason = null,
      won_member_id = null,
      won_plan_code = null,
      updated_by = actor.id,
      updated_at = now()
  where tenant_id = booking_row.tenant_id
    and trial_booking_id = booking_row.trial_booking_id
    and status = 'won';

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id,
    actor.id,
    'fa_conversion_restored',
    'booking',
    booking_row.id::text,
    'manager_correction',
    jsonb_build_object(
      'contractId', contract_row.id,
      'paymentId', payment_row.id,
      'paymentAmount', payment_row.amount,
      'previousContractStatus', contract_row.status,
      'previousUnlockedSessions', contract_row.unlocked_sessions
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'contractId', contract_row.id,
    'restored', true
  );
end;
$$;

revoke all on function public.bige_restore_fa_conversion(uuid)
  from public, anon;
grant execute on function public.bige_restore_fa_conversion(uuid)
  to authenticated;

commit;
