-- Transaction hardening for payment / redemption / member booking modification flows.
-- Date: 2026-02-07

create unique index if not exists session_redemptions_booking_unique
  on public.session_redemptions(booking_id)
  where booking_id is not null;

create or replace function public.process_manual_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_gateway_ref text default null
)
returns table (
  payment_id uuid,
  order_id uuid,
  payment_amount numeric,
  payment_status text,
  payment_method text,
  paid_at timestamptz,
  order_status text,
  should_fulfill boolean
)
language plpgsql
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_paid_total numeric := 0;
  v_remaining_before numeric := 0;
  v_remaining_after numeric := 0;
  v_next_order_status text;
  v_prev_order_status text;
begin
  if p_tenant_id is null or p_order_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'invalid_payment_input';
  end if;

  if p_method not in ('cash', 'card', 'transfer', 'newebpay', 'manual') then
    raise exception 'invalid_payment_method';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order.status in ('cancelled', 'refunded') then
    raise exception 'order_closed';
  end if;

  if v_order.status = 'paid' then
    raise exception 'order_already_paid';
  end if;

  v_prev_order_status := v_order.status;

  select coalesce(sum(amount), 0)
  into v_paid_total
  from public.payments
  where tenant_id = p_tenant_id
    and order_id = p_order_id
    and status = 'paid';

  v_remaining_before := greatest(0, coalesce(v_order.amount, 0) - coalesce(v_paid_total, 0));

  if p_amount > v_remaining_before then
    raise exception 'payment_exceeds_remaining';
  end if;

  insert into public.payments (
    tenant_id,
    order_id,
    amount,
    status,
    method,
    gateway_ref,
    paid_at
  )
  values (
    p_tenant_id,
    p_order_id,
    p_amount,
    'paid',
    p_method,
    p_gateway_ref,
    now()
  )
  returning * into v_payment;

  v_remaining_after := greatest(0, v_remaining_before - p_amount);
  v_next_order_status := case when v_remaining_after <= 0 then 'paid' else 'confirmed' end;

  update public.orders
  set status = v_next_order_status,
      updated_at = now()
  where id = p_order_id
    and tenant_id = p_tenant_id;

  return query
  select
    v_payment.id,
    v_payment.order_id,
    v_payment.amount,
    v_payment.status,
    v_payment.method,
    v_payment.paid_at,
    v_next_order_status,
    (v_next_order_status = 'paid' and v_prev_order_status <> 'paid');
end;
$$;

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

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status <> 'paid' then
    raise exception 'payment_not_refundable';
  end if;

  update public.payments
  set status = 'refunded',
      updated_at = now()
  where id = p_payment_id
    and tenant_id = p_tenant_id
  returning * into v_payment;

  select *
  into v_order
  from public.orders
  where id = v_payment.order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  select coalesce(sum(amount), 0)
  into v_paid_total
  from public.payments
  where tenant_id = p_tenant_id
    and order_id = v_payment.order_id
    and status = 'paid';

  v_next_order_status := case
    when v_paid_total >= coalesce(v_order.amount, 0) then 'paid'
    when v_paid_total > 0 then 'confirmed'
    else 'refunded'
  end;

  update public.orders
  set status = v_next_order_status,
      updated_at = now()
  where id = v_payment.order_id
    and tenant_id = p_tenant_id;

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

create or replace function public.redeem_session(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_member_id uuid,
  p_redeemed_by uuid,
  p_redeemed_kind text,
  p_pass_id uuid,
  p_quantity integer,
  p_note text
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
begin
  if p_tenant_id is null or p_member_id is null then
    raise exception 'invalid_redemption_input';
  end if;

  if p_redeemed_kind not in ('monthly', 'pass') then
    raise exception 'invalid_redeemed_kind';
  end if;

  if p_redeemed_kind = 'pass' then
    if p_pass_id is null then
      raise exception 'pass_id_required';
    end if;

    select *
    into v_pass
    from public.entry_passes
    where id = p_pass_id
      and tenant_id = p_tenant_id
      and member_id = p_member_id
    for update;

    if not found then
      raise exception 'pass_not_found';
    end if;

    if coalesce(v_pass.remaining, 0) < v_quantity then
      raise exception 'insufficient_remaining_sessions';
    end if;

    update public.entry_passes
    set remaining = coalesce(remaining, 0) - v_quantity,
        updated_at = now()
    where id = p_pass_id
      and tenant_id = p_tenant_id;
  end if;

  insert into public.session_redemptions (
    tenant_id,
    booking_id,
    member_id,
    redeemed_by,
    redeemed_kind,
    pass_id,
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
    v_quantity,
    p_note
  )
  returning * into v_redemption;

  if p_booking_id is not null then
    update public.bookings
    set status = 'completed',
        updated_at = now()
    where id = p_booking_id
      and tenant_id = p_tenant_id
      and status in ('booked', 'checked_in');
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

create or replace function public.member_modify_booking(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_member_id uuid,
  p_actor_id uuid,
  p_action text,
  p_reason text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_lock_minutes integer default 120
)
returns table (
  booking_id uuid,
  coach_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  note text
)
language plpgsql
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_prev_starts_at timestamptz;
  v_action text := case when p_action = 'reschedule' then 'reschedule' else 'cancel' end;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
    and tenant_id = p_tenant_id
    and member_id = p_member_id
  for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.status <> 'booked' then
    raise exception 'booking_not_modifiable';
  end if;

  v_prev_starts_at := v_booking.starts_at;

  if now() >= (v_booking.starts_at - make_interval(mins => greatest(1, coalesce(p_lock_minutes, 120)))) then
    raise exception 'booking_locked_for_modification';
  end if;

  if v_action = 'cancel' then
    update public.bookings
    set status = 'cancelled',
        note = p_reason,
        updated_at = now()
    where id = p_booking_id
      and tenant_id = p_tenant_id
      and member_id = p_member_id
    returning * into v_booking;

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
      'member_booking_cancel',
      'booking',
      p_booking_id::text,
      p_reason,
      jsonb_build_object('previousStartsAt', v_prev_starts_at)
    );

    return query
    select
      v_booking.id,
      v_booking.coach_id,
      v_booking.service_name,
      v_booking.starts_at,
      v_booking.ends_at,
      v_booking.status,
      v_booking.note;
    return;
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception 'reschedule_time_required';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_reschedule_range';
  end if;

  if p_starts_at <= now() then
    raise exception 'reschedule_must_be_future';
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.tenant_id = p_tenant_id
      and b.member_id = p_member_id
      and b.status in ('booked', 'checked_in')
      and b.id <> p_booking_id
      and b.starts_at < p_ends_at
      and b.ends_at > p_starts_at
  ) then
    raise exception 'booking_time_overlap';
  end if;

  update public.bookings
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      note = p_reason,
      updated_at = now()
  where id = p_booking_id
    and tenant_id = p_tenant_id
    and member_id = p_member_id
  returning * into v_booking;

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
    'member_booking_reschedule',
    'booking',
    p_booking_id::text,
    p_reason,
    jsonb_build_object(
      'previousStartsAt', v_prev_starts_at,
      'nextStartsAt', p_starts_at,
      'nextEndsAt', p_ends_at
    )
  );

  return query
  select
    v_booking.id,
    v_booking.coach_id,
    v_booking.service_name,
    v_booking.starts_at,
    v_booking.ends_at,
    v_booking.status,
    v_booking.note;
end;
$$;

create or replace function public.apply_newebpay_webhook(
  p_payment_id uuid,
  p_status text,
  p_gateway_ref text,
  p_signature text,
  p_raw_payload jsonb
)
returns table (
  tenant_id uuid,
  order_id uuid,
  payment_id uuid,
  payment_status text,
  order_status text,
  should_fulfill boolean
)
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_next_payment_status text;
  v_prev_order_status text;
  v_next_order_status text;
  v_paid_total numeric := 0;
begin
  if p_status not in ('paid', 'failed', 'pending') then
    raise exception 'invalid_webhook_status';
  end if;

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  v_next_payment_status := p_status;

  update public.payments
  set status = v_next_payment_status,
      gateway_ref = p_gateway_ref,
      paid_at = case when v_next_payment_status = 'paid' then now() else null end,
      updated_at = now()
  where id = p_payment_id
  returning * into v_payment;

  select *
  into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  v_prev_order_status := v_order.status;

  select coalesce(sum(amount), 0)
  into v_paid_total
  from public.payments
  where tenant_id = v_payment.tenant_id
    and order_id = v_payment.order_id
    and status = 'paid';

  v_next_order_status := case
    when v_paid_total >= coalesce(v_order.amount, 0) then 'paid'
    when v_paid_total > 0 then 'confirmed'
    else 'confirmed'
  end;

  update public.orders
  set status = v_next_order_status,
      updated_at = now()
  where id = v_order.id;

  insert into public.payment_webhooks (
    tenant_id,
    provider,
    event_type,
    payment_id,
    raw_payload,
    signature,
    status,
    processed_at
  )
  values (
    v_payment.tenant_id,
    'newebpay',
    v_next_payment_status,
    v_payment.id,
    coalesce(p_raw_payload, '{}'::jsonb),
    p_signature,
    'processed',
    now()
  );

  return query
  select
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.status,
    v_next_order_status,
    (v_next_order_status = 'paid' and v_prev_order_status <> 'paid');
end;
$$;
