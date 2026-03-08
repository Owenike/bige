-- Phase 5.6 staging validation hotfix:
-- Resolve PL/pgSQL variable/column ambiguity for refund and redemption RPCs.

create or replace function public.refund_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns table (
  payment_id uuid,
  order_id uuid,
  payment_status text,
  updated_at timestamptz,
  order_status text
)
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_paid_total numeric := 0;
  v_next_order_status text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;

  select pay.*
  into v_payment
  from public.payments as pay
  where pay.id = p_payment_id
    and pay.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status <> 'paid' then
    raise exception 'payment_not_refundable';
  end if;

  update public.payments as pay
  set status = 'refunded',
      updated_at = now()
  where pay.id = p_payment_id
    and pay.tenant_id = p_tenant_id
  returning pay.* into v_payment;

  select ord.*
  into v_order
  from public.orders as ord
  where ord.id = v_payment.order_id
    and ord.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  select coalesce(sum(pay.amount), 0)
  into v_paid_total
  from public.payments as pay
  where pay.tenant_id = p_tenant_id
    and pay.order_id = v_payment.order_id
    and pay.status = 'paid';

  v_next_order_status := case
    when v_paid_total >= coalesce(v_order.amount, 0) then 'paid'
    when v_paid_total > 0 then 'confirmed'
    else 'refunded'
  end;

  update public.orders as ord
  set status = v_next_order_status,
      updated_at = now()
  where ord.id = v_payment.order_id
    and ord.tenant_id = p_tenant_id;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  )
  values (
    p_tenant_id,
    p_actor_id,
    'payment_refund',
    'payment',
    p_payment_id::text,
    p_reason,
    jsonb_build_object('orderId', v_payment.order_id)
  );

  return query
  select
    v_payment.id,
    v_payment.order_id,
    v_payment.status,
    v_payment.updated_at,
    v_next_order_status;
end;
$$;

drop function if exists public.redeem_session(uuid, uuid, uuid, uuid, text, uuid, integer, text);

create or replace function public.redeem_session(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_member_id uuid,
  p_redeemed_by uuid,
  p_redeemed_kind text,
  p_pass_id uuid,
  p_quantity integer,
  p_note text,
  p_session_no integer default null
)
returns table (
  redemption_id uuid,
  booking_id uuid,
  member_id uuid,
  redeemed_kind text,
  quantity integer,
  note text,
  created_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_redemption public.session_redemptions%rowtype;
  v_pass public.entry_passes%rowtype;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  v_session_no integer := null;
  v_match text[];
begin
  if p_tenant_id is null or p_member_id is null then
    raise exception 'invalid_redemption_input';
  end if;

  if p_redeemed_kind not in ('monthly', 'pass') then
    raise exception 'invalid_redeemed_kind';
  end if;

  if p_session_no is not null and p_session_no > 0 then
    v_session_no := p_session_no;
  elsif p_note is not null then
    v_match := regexp_match(p_note, 'session_no:([0-9]+)');
    if array_length(v_match, 1) = 1 then
      v_session_no := nullif(v_match[1], '')::integer;
    end if;
  end if;

  if p_redeemed_kind = 'pass' then
    if p_pass_id is null then
      raise exception 'pass_id_required';
    end if;

    select ep.*
    into v_pass
    from public.entry_passes as ep
    where ep.id = p_pass_id
      and ep.tenant_id = p_tenant_id
      and ep.member_id = p_member_id
    for update;

    if not found then
      raise exception 'pass_not_found';
    end if;

    if coalesce(v_pass.remaining, 0) < v_quantity then
      raise exception 'insufficient_remaining_sessions';
    end if;

    update public.entry_passes as ep
    set remaining = coalesce(ep.remaining, 0) - v_quantity,
        updated_at = now()
    where ep.id = p_pass_id
      and ep.tenant_id = p_tenant_id;
  else
    v_session_no := null;
  end if;

  insert into public.session_redemptions (
    tenant_id,
    booking_id,
    member_id,
    redeemed_by,
    redeemed_kind,
    pass_id,
    session_no,
    quantity,
    note
  )
  values (
    p_tenant_id,
    p_booking_id,
    p_member_id,
    p_redeemed_by,
    p_redeemed_kind,
    p_pass_id,
    v_session_no,
    v_quantity,
    p_note
  )
  returning * into v_redemption;

  if p_booking_id is not null then
    update public.bookings as b
    set status = 'completed',
        updated_at = now()
    where b.id = p_booking_id
      and b.tenant_id = p_tenant_id
      and b.status in ('booked', 'checked_in');
  end if;

  return query
  select
    v_redemption.id,
    v_redemption.booking_id,
    v_redemption.member_id,
    v_redemption.redeemed_kind,
    v_redemption.quantity,
    v_redemption.note,
    v_redemption.created_at;
end;
$$;
