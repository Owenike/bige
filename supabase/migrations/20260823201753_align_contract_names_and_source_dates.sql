begin;

-- FA conversions use the historical schedule date as the contract issue date.
-- The route handler applies the same rule, while this RPC remains the database
-- authority for direct authenticated callers.
create or replace function public.bige_create_member_contract_v3(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_source_booking_id uuid,
  p_full_name text,
  p_phone text,
  p_birth_date date,
  p_email text,
  p_email_unavailable boolean,
  p_plan_mode text,
  p_plan_id uuid,
  p_custom_plan jsonb,
  p_signed_on date,
  p_pin text,
  p_initial_payment bigint,
  p_payment_method text,
  p_installment_count integer,
  p_payment_schedule jsonb,
  p_future_trial_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_signed_on date;
  result jsonb;
  created_contract_id uuid;
begin
  if p_payment_method = 'ecpay_installment' then
    if p_installment_count is null or p_installment_count not between 2 and 60 then
      raise exception 'invalid_installment_count';
    end if;
  elsif p_installment_count is not null then
    raise exception 'installment_count_not_allowed';
  end if;

  if p_source_booking_id is not null then
    select (booking.starts_at at time zone 'Asia/Taipei')::date
    into resolved_signed_on
    from public.bookings booking
    where booking.id = p_source_booking_id
      and booking.tenant_id = p_tenant_id;
  else
    resolved_signed_on := p_signed_on;
  end if;

  result := public.bige_create_member_contract_v2(
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_source_booking_id,
    p_full_name,
    p_phone,
    p_birth_date,
    p_email,
    p_email_unavailable,
    p_plan_mode,
    p_plan_id,
    p_custom_plan,
    resolved_signed_on,
    p_pin,
    p_initial_payment,
    p_payment_method,
    p_payment_schedule,
    p_future_trial_action
  );

  created_contract_id := (result->>'contractId')::uuid;

  if p_initial_payment > 0 then
    update public.bige_contract_payments
    set installment_count = p_installment_count
    where contract_id = created_contract_id
      and idempotency_key = 'contract-create:' || created_contract_id::text;

    if not found then
      raise exception 'contract_initial_payment_not_found';
    end if;
  end if;

  return result || jsonb_build_object(
    'signedOn', resolved_signed_on,
    'installmentCount', p_installment_count
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v3(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v3(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text
) to authenticated;

-- The BB wrapper links its source booking after the initial contract insert.
-- This trigger keeps FA and BB dates aligned at the table boundary and also
-- shifts the derived start/original-expiry/current-expiry dates by the same
-- number of days without changing the contract duration or extension balance.
create or replace function public.bige_align_contract_dates_to_source_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_business_date date;
  shift_days integer;
begin
  if new.converted_from_booking_id is null or new.signed_on is null then
    return new;
  end if;

  select (booking.starts_at at time zone 'Asia/Taipei')::date
  into source_business_date
  from public.bookings booking
  where booking.id = new.converted_from_booking_id
    and booking.tenant_id = new.tenant_id
    and booking.is_bige_schedule = true
    and booking.operation_kind in ('trial', 'bb');

  if source_business_date is null or source_business_date = new.signed_on then
    return new;
  end if;

  shift_days := source_business_date - new.signed_on;
  new.signed_on := source_business_date;
  new.starts_at := case
    when new.starts_at is null then null
    else new.starts_at + make_interval(days => shift_days)
  end;
  new.ends_at := case
    when new.ends_at is null then null
    else new.ends_at + make_interval(days => shift_days)
  end;
  new.original_ends_at := case
    when new.original_ends_at is null then null
    else new.original_ends_at + make_interval(days => shift_days)
  end;
  return new;
end;
$$;

revoke all on function public.bige_align_contract_dates_to_source_booking() from public, anon, authenticated;

drop trigger if exists bige_align_contract_dates_to_source_booking_trigger
  on public.member_plan_contracts;
create trigger bige_align_contract_dates_to_source_booking_trigger
before insert or update of signed_on, converted_from_booking_id
on public.member_plan_contracts
for each row
execute function public.bige_align_contract_dates_to_source_booking();

-- Correct existing FA/BB contracts that were reconstructed on a later day.
-- A no-op assignment intentionally invokes the alignment trigger above.
update public.member_plan_contracts contract
set signed_on = contract.signed_on
from public.bookings booking
where booking.id = contract.converted_from_booking_id
  and booking.tenant_id = contract.tenant_id
  and booking.is_bige_schedule = true
  and booking.operation_kind in ('trial', 'bb')
  and contract.signed_on is not null
  and contract.signed_on is distinct from
    (booking.starts_at at time zone 'Asia/Taipei')::date;

-- Renewal contracts are not linked through converted_from_booking_id. During
-- construction their contract-create payment carries either the originating
-- class booking or the explicitly recorded historical payment date.
with renewal_source as (
  select distinct on (contract.id)
    contract.id as contract_id,
    coalesce(
      (booking.starts_at at time zone 'Asia/Taipei')::date,
      (payment.paid_at at time zone 'Asia/Taipei')::date
    ) as source_business_date
  from public.member_plan_contracts contract
  join public.bige_contract_payments payment
    on payment.contract_id = contract.id
   and payment.tenant_id = contract.tenant_id
  left join public.bookings booking
    on booking.id = payment.source_booking_id
   and booking.tenant_id = contract.tenant_id
  where contract.sales_origin_kind = 'renewal'
    and contract.signed_on is not null
    and payment.status in ('recorded', 'voided')
    and payment.idempotency_key = 'contract-create:' || contract.id::text
  order by contract.id, payment.paid_at, payment.id
)
update public.member_plan_contracts contract
set
  starts_at = case
    when contract.starts_at is null then null
    else contract.starts_at + make_interval(
      days => renewal_source.source_business_date - contract.signed_on
    )
  end,
  ends_at = case
    when contract.ends_at is null then null
    else contract.ends_at + make_interval(
      days => renewal_source.source_business_date - contract.signed_on
    )
  end,
  original_ends_at = case
    when contract.original_ends_at is null then null
    else contract.original_ends_at + make_interval(
      days => renewal_source.source_business_date - contract.signed_on
    )
  end,
  signed_on = renewal_source.source_business_date,
  updated_at = now()
from renewal_source
where contract.id = renewal_source.contract_id
  and renewal_source.source_business_date is not null
  and contract.signed_on is distinct from renewal_source.source_business_date;

commit;
