begin;

create or replace function public.bige_update_contract_payment(
  p_payment_id uuid,
  p_payment_kind text,
  p_amount bigint,
  p_method text,
  p_installment_count integer,
  p_status text,
  p_note text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  payment_row public.bige_contract_payments%rowtype;
  previous_payment jsonb;
  contract_row public.member_plan_contracts%rowtype;
  total_paid bigint;
  recorded_payment_count integer;
  has_recorded_deposit boolean;
  has_refunded_payment boolean;
  previous_unlocked integer;
  next_unlocked integer;
  next_payment_status text;
  next_contract_status text;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.department = 'coaching'
         and actor.position in (
           'coach_assistant_manager',
           'coach_manager',
           'coach_city_manager'
         )
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in (
           'manager',
           'supervisor',
           'branch_manager',
           'store_owner',
           'store_manager'
         )
       )
     ) then
    raise exception 'manager_required';
  end if;

  if p_payment_kind not in ('deposit', 'balance', 'installment') then
    raise exception 'payment_kind_invalid';
  end if;
  if p_amount <= 0 then
    raise exception 'payment_amount_invalid';
  end if;
  if p_method not in (
    'cash', 'bank_transfer', 'card_terminal', 'ecpay',
    'ecpay_installment', 'acpay', 'other'
  ) then
    raise exception 'payment_method_invalid';
  end if;
  if p_status not in ('recorded', 'voided', 'refunded') then
    raise exception 'payment_status_invalid';
  end if;
  if p_method = 'ecpay_installment' then
    if p_installment_count is null or p_installment_count not between 2 and 60 then
      raise exception 'invalid_installment_count';
    end if;
  elsif p_installment_count is not null then
    raise exception 'installment_count_not_allowed';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'payment_edit_reason_required';
  end if;

  select * into payment_row
  from public.bige_contract_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;
  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from payment_row.tenant_id then
    raise exception 'forbidden';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = payment_row.contract_id
  for update;

  if not found
     or contract_row.total_amount is null
     or contract_row.total_sessions is null
     or contract_row.total_amount <= 0
     or contract_row.total_sessions <= 0 then
    raise exception 'fitness_contract_not_found';
  end if;
  if p_amount > contract_row.total_amount then
    raise exception 'payment_total_exceeds_contract_amount';
  end if;

  previous_payment := jsonb_build_object(
    'paymentKind', payment_row.payment_kind,
    'amount', payment_row.amount,
    'method', payment_row.method,
    'installmentCount', payment_row.installment_count,
    'status', payment_row.status,
    'note', payment_row.note
  );
  previous_unlocked := contract_row.unlocked_sessions;

  update public.bige_contract_payments
  set payment_kind = p_payment_kind,
      amount = p_amount,
      method = p_method,
      installment_count = p_installment_count,
      status = p_status,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      voided_by = case when p_status = 'recorded' then null else actor.id end,
      voided_at = case when p_status = 'recorded' then null else now() end,
      void_reason = case when p_status = 'recorded' then null else btrim(p_reason) end
  where id = payment_row.id
  returning * into payment_row;

  select
    coalesce(sum(amount) filter (where status = 'recorded'), 0)::bigint,
    count(*) filter (where status = 'recorded')::integer,
    coalesce(bool_or(payment_kind = 'deposit') filter (where status = 'recorded'), false),
    coalesce(bool_or(status = 'refunded'), false)
  into total_paid, recorded_payment_count, has_recorded_deposit, has_refunded_payment
  from public.bige_contract_payments
  where contract_id = contract_row.id;

  if total_paid > contract_row.total_amount then
    raise exception 'payment_total_exceeds_contract_amount';
  end if;

  next_unlocked := least(
    contract_row.total_sessions,
    floor(total_paid::numeric * contract_row.total_sessions / contract_row.total_amount)::integer
  );
  next_payment_status := case
    when total_paid = 0 and has_refunded_payment then 'refunded'
    when total_paid = 0 then 'unpaid'
    when total_paid >= contract_row.total_amount then 'settled'
    when recorded_payment_count = 1 and has_recorded_deposit then 'deposit_paid'
    else 'partially_paid'
  end;
  next_contract_status := case
    when contract_row.used_sessions > next_unlocked then 'frozen'
    when contract_row.ends_at is not null and contract_row.ends_at <= now() then 'expired'
    when contract_row.used_sessions >= contract_row.total_sessions then 'exhausted'
    when next_unlocked > contract_row.used_sessions then 'active'
    else 'pending'
  end;

  update public.member_plan_contracts
  set unlocked_sessions = next_unlocked,
      remaining_sessions = greatest(next_unlocked - used_sessions, 0),
      payment_status = next_payment_status,
      status = next_contract_status,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

  update public.bige_contract_payment_schedule schedule
  set paid_amount = least(
        schedule.due_amount,
        coalesce((
          select sum(linked.amount)
          from public.bige_contract_payments linked
          where linked.schedule_item_id = schedule.id
            and linked.status = 'recorded'
        ), 0)
      ),
      status = case
        when coalesce((
          select sum(linked.amount)
          from public.bige_contract_payments linked
          where linked.schedule_item_id = schedule.id
            and linked.status = 'recorded'
        ), 0) >= schedule.due_amount then 'paid'
        when coalesce((
          select sum(linked.amount)
          from public.bige_contract_payments linked
          where linked.schedule_item_id = schedule.id
            and linked.status = 'recorded'
        ), 0) > 0 then 'partial'
        when schedule.due_on < (now() at time zone 'Asia/Taipei')::date then 'overdue'
        else 'unpaid'
      end,
      updated_at = now()
  where schedule.contract_id = contract_row.id
    and schedule.status <> 'voided';

  if next_unlocked <> previous_unlocked then
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
      contract_row.tenant_id,
      contract_row.branch_id,
      contract_row.member_id,
      contract_row.id,
      case when next_unlocked < previous_unlocked then 'refund_reversal' else 'grant' end,
      next_unlocked - previous_unlocked,
      contract_row.remaining_sessions,
      'contract_payment',
      payment_row.id::text,
      btrim(p_reason),
      jsonb_build_object(
        'action', 'payment_edited',
        'totalPaid', total_paid,
        'previousUnlockedSessions', previous_unlocked,
        'unlockedSessions', next_unlocked
      ),
      actor.id
    );
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    contract_row.tenant_id,
    actor.id,
    'fitness_contract_payment_updated',
    'bige_contract_payment',
    payment_row.id::text,
    btrim(p_reason),
    jsonb_build_object(
      'contractId', contract_row.id,
      'before', previous_payment,
      'after', jsonb_build_object(
        'paymentKind', payment_row.payment_kind,
        'amount', payment_row.amount,
        'method', payment_row.method,
        'installmentCount', payment_row.installment_count,
        'status', payment_row.status,
        'note', payment_row.note
      ),
      'totalPaid', total_paid,
      'outstandingBalance', greatest(contract_row.total_amount - total_paid, 0),
      'unlockedSessions', next_unlocked,
      'contractStatus', next_contract_status,
      'contractPaymentStatus', next_payment_status
    )
  );

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'contractId', contract_row.id,
    'totalPaid', total_paid,
    'outstandingBalance', greatest(contract_row.total_amount - total_paid, 0),
    'unlockedSessions', contract_row.unlocked_sessions,
    'remainingSessions', contract_row.remaining_sessions,
    'contractStatus', contract_row.status,
    'contractPaymentStatus', contract_row.payment_status
  );
end;
$$;

revoke all on function public.bige_update_contract_payment(
  uuid, text, bigint, text, integer, text, text, text
) from public, anon;
grant execute on function public.bige_update_contract_payment(
  uuid, text, bigint, text, integer, text, text, text
) to authenticated;

commit;
