begin;

-- A payment recorded from a BIG E schedule card belongs to that card's
-- business date. Preserve the entered Taipei time-of-day while replacing only
-- the date, so reconstructed FA, BB, renewal, and final-payment receipts do
-- not appear on the later system-entry date.
create or replace function public.bige_align_payment_date_to_source_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolved_source_booking_id uuid;
  source_starts_at timestamptz;
  source_business_date date;
begin
  -- The legacy FA RPC inserts its first receipt before it can explicitly
  -- attach the source. Recover only the contract-create source that is already
  -- trusted on the contract; ordinary later payments remain unchanged.
  if new.source_booking_id is null
     and new.contract_id is not null
     and new.idempotency_key like
       'contract-create:' || new.contract_id::text || '%' then
    select contract.converted_from_booking_id
    into resolved_source_booking_id
    from public.member_plan_contracts contract
    join public.bookings booking
      on booking.id = contract.converted_from_booking_id
     and booking.tenant_id = contract.tenant_id
     and booking.is_bige_schedule = true
     and booking.operation_kind in ('trial', 'bb')
    where contract.id = new.contract_id
      and contract.tenant_id = new.tenant_id;

    new.source_booking_id := resolved_source_booking_id;
  end if;

  if new.source_booking_id is null then
    return new;
  end if;

  select booking.starts_at
  into source_starts_at
  from public.bookings booking
  where booking.id = new.source_booking_id
    and booking.tenant_id = new.tenant_id
    and booking.is_bige_schedule = true;

  if source_starts_at is null then
    raise exception 'payment_source_booking_invalid';
  end if;

  source_business_date :=
    (source_starts_at at time zone 'Asia/Taipei')::date;

  if (coalesce(new.paid_at, now()) at time zone 'Asia/Taipei')::date
     is distinct from source_business_date then
    new.paid_at := (
      source_business_date
      + (coalesce(new.paid_at, now()) at time zone 'Asia/Taipei')::time
    ) at time zone 'Asia/Taipei';
  end if;

  return new;
end;
$$;

revoke all on function public.bige_align_payment_date_to_source_booking()
from public, anon, authenticated;

drop trigger if exists bige_align_payment_date_to_source_booking_trigger
on public.bige_contract_payments;

create trigger bige_align_payment_date_to_source_booking_trigger
before insert or update of source_booking_id, paid_at
on public.bige_contract_payments
for each row
execute function public.bige_align_payment_date_to_source_booking();

-- Preserve the single-payment API while carrying the same trusted source link
-- as the split-payment API. The linked trigger above owns the final date.
create or replace function public.bige_record_contract_payment_v3(
  p_contract_id uuid,
  p_source_booking_id uuid,
  p_schedule_item_id uuid,
  p_payment_kind text,
  p_amount bigint,
  p_method text,
  p_installment_count integer,
  p_paid_at timestamptz,
  p_idempotency_key text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  payment_id uuid;
  payment_paid_at timestamptz;
begin
  if p_source_booking_id is not null and not exists (
    select 1
    from public.member_plan_contracts contract
    join public.bookings booking
      on booking.id = p_source_booking_id
     and booking.tenant_id = contract.tenant_id
     and booking.member_id = contract.member_id
     and booking.is_bige_schedule = true
    where contract.id = p_contract_id
  ) then
    raise exception 'payment_source_booking_invalid';
  end if;

  result := public.bige_record_contract_payment_v2(
    p_contract_id,
    p_schedule_item_id,
    p_payment_kind,
    p_amount,
    p_method,
    p_installment_count,
    p_paid_at,
    p_idempotency_key,
    p_note
  );
  payment_id := (result->>'paymentId')::uuid;

  if p_source_booking_id is not null then
    update public.bige_contract_payments payment
    set source_booking_id = p_source_booking_id
    where payment.id = payment_id
      and (
        payment.source_booking_id is null
        or payment.source_booking_id = p_source_booking_id
      )
    returning payment.paid_at into payment_paid_at;

    if not found then
      raise exception 'idempotency_key_conflict';
    end if;
  else
    select payment.paid_at
    into payment_paid_at
    from public.bige_contract_payments payment
    where payment.id = payment_id;
  end if;

  return result || jsonb_build_object(
    'sourceBookingId', p_source_booking_id,
    'paidAt', payment_paid_at
  );
end;
$$;

revoke all on function public.bige_record_contract_payment_v3(
  uuid, uuid, uuid, text, bigint, text, integer, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payment_v3(
  uuid, uuid, uuid, text, bigint, text, integer, timestamptz, text, text
) to authenticated;

-- Snapshot the exact safe backfill set before changing it. A direct payment
-- source wins; otherwise only the contract-create receipt may inherit the
-- FA/BB conversion booking. Later installments without their own booking are
-- deliberately excluded.
create temporary table bige_payment_date_alignment_changes
on commit drop
as
select
  payment.id as payment_id,
  payment.tenant_id,
  payment.paid_at as previous_paid_at,
  booking.starts_at as source_starts_at,
  (booking.starts_at at time zone 'Asia/Taipei')::date
    as source_business_date,
  (
    (booking.starts_at at time zone 'Asia/Taipei')::date
    + (payment.paid_at at time zone 'Asia/Taipei')::time
  ) at time zone 'Asia/Taipei' as aligned_paid_at,
  booking.id as source_booking_id
from public.bige_contract_payments payment
join public.member_plan_contracts contract
  on contract.id = payment.contract_id
 and contract.tenant_id = payment.tenant_id
join public.bookings booking
  on booking.id = coalesce(
    payment.source_booking_id,
    case
      when contract.converted_from_booking_id is not null
       and payment.idempotency_key like
         'contract-create:' || contract.id::text || '%'
        then contract.converted_from_booking_id
    end
  )
 and booking.tenant_id = payment.tenant_id
 and booking.is_bige_schedule = true
where (payment.paid_at at time zone 'Asia/Taipei')::date
  is distinct from (booking.starts_at at time zone 'Asia/Taipei')::date;

-- Complete the missing source link on older FA/BB initial receipts. The new
-- trigger also aligns any such receipt whose payment date is still stale.
update public.bige_contract_payments payment
set source_booking_id = contract.converted_from_booking_id
from public.member_plan_contracts contract
join public.bookings booking
  on booking.id = contract.converted_from_booking_id
 and booking.tenant_id = contract.tenant_id
 and booking.is_bige_schedule = true
 and booking.operation_kind in ('trial', 'bb')
where payment.contract_id = contract.id
  and payment.tenant_id = contract.tenant_id
  and payment.source_booking_id is null
  and payment.idempotency_key like
    'contract-create:' || contract.id::text || '%';

-- Align every remaining source-linked payment captured above. This covers
-- renewal and final-payment receipts whose source link already existed.
update public.bige_contract_payments payment
set paid_at = change.aligned_paid_at
from bige_payment_date_alignment_changes change
where payment.id = change.payment_id
  and payment.paid_at is distinct from change.aligned_paid_at;

-- Keep the unconfirmed settlement inbox on the same business date. Confirmed
-- daily reports remain immutable and require explicit manager correction.
update public.staff_sales_events event
set
  business_date = change.source_business_date,
  source_occurred_at = case
    when event.source_type in ('fa', 'bb') then change.source_starts_at
    else change.aligned_paid_at
  end,
  metadata = coalesce(event.metadata, '{}'::jsonb) || jsonb_build_object(
    'previousPaymentPaidAt', change.previous_paid_at,
    'paymentPaidAt', change.aligned_paid_at,
    'settlementDateSource', case
      when event.source_type in ('fa', 'bb') then 'origin_booking'
      else 'payment_source_booking'
    end,
    'originBookingStartsAt', change.source_starts_at
  ),
  updated_at = now()
from bige_payment_date_alignment_changes change
where event.tenant_id = change.tenant_id
  and event.source_table = 'bige_contract_payments'
  and event.source_id = change.payment_id
  and event.status <> 'daily_confirmed';

-- Remove only stale, unconfirmed daily-top results left on an old system-entry
-- date that no longer contains any eligible receipts.
with affected_old_dates as (
  select distinct
    event.tenant_id,
    event.branch_id,
    (change.previous_paid_at at time zone 'Asia/Taipei')::date as old_date
  from bige_payment_date_alignment_changes change
  join public.staff_sales_events event
    on event.tenant_id = change.tenant_id
   and event.source_table = 'bige_contract_payments'
   and event.source_id = change.payment_id
  where event.status <> 'daily_confirmed'
), empty_old_dates as (
  select affected.*
  from affected_old_dates affected
  where not exists (
    select 1
    from public.staff_sales_events current_event
    where current_event.tenant_id = affected.tenant_id
      and current_event.branch_id is not distinct from affected.branch_id
      and current_event.business_date = affected.old_date
      and current_event.source_type in (
        'fa', 'bb', 'renewal', 'final_payment'
      )
      and current_event.amount > 0
      and current_event.origin_employee_id is not null
      and coalesce(
        current_event.metadata ->> 'paymentStatus', ''
      ) not in ('refunded', 'voided')
  )
)
update public.staff_epo_awards award
set
  status = 'cancelled',
  review_note = '付款日期校正後，原系統建檔日已無每日最高業績',
  updated_at = now()
from public.staff_epo_daily_top_states state
join empty_old_dates affected
  on affected.tenant_id = state.tenant_id
 and affected.branch_id is not distinct from state.branch_id
 and affected.old_date = state.business_date
where award.id = state.active_award_id
  and award.status <> 'daily_confirmed';

with affected_old_dates as (
  select distinct
    event.tenant_id,
    event.branch_id,
    (change.previous_paid_at at time zone 'Asia/Taipei')::date as old_date
  from bige_payment_date_alignment_changes change
  join public.staff_sales_events event
    on event.tenant_id = change.tenant_id
   and event.source_table = 'bige_contract_payments'
   and event.source_id = change.payment_id
  where event.status <> 'daily_confirmed'
), empty_old_dates as (
  select affected.*
  from affected_old_dates affected
  where not exists (
    select 1
    from public.staff_sales_events current_event
    where current_event.tenant_id = affected.tenant_id
      and current_event.branch_id is not distinct from affected.branch_id
      and current_event.business_date = affected.old_date
      and current_event.source_type in (
        'fa', 'bb', 'renewal', 'final_payment'
      )
      and current_event.amount > 0
      and current_event.origin_employee_id is not null
      and coalesce(
        current_event.metadata ->> 'paymentStatus', ''
      ) not in ('refunded', 'voided')
  )
)
update public.staff_epo_daily_top_states state
set
  top_amount = 0,
  candidate_employee_ids = '{}',
  selected_employee_id = null,
  status = 'none',
  active_award_id = null,
  source_fingerprint = '',
  decision_by = null,
  decision_at = null,
  updated_at = now()
from empty_old_dates affected
where state.tenant_id = affected.tenant_id
  and state.branch_id is not distinct from affected.branch_id
  and state.business_date = affected.old_date
  and not exists (
    select 1
    from public.staff_epo_awards award
    where award.id = state.active_award_id
      and award.status = 'daily_confirmed'
  );

commit;
