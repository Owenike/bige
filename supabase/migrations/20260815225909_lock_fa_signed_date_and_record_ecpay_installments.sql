-- FA conversions always use the current Taiwan business date. ECPay
-- installment counts are stored structurally on each payment record.

alter table public.bige_contract_payments
  add column if not exists installment_count integer;

alter table public.bige_contract_payments
  drop constraint if exists bige_contract_payments_installment_count_check;

alter table public.bige_contract_payments
  add constraint bige_contract_payments_installment_count_check
  check (
    installment_count is null
    or (
      method = 'ecpay_installment'
      and installment_count between 2 and 60
    )
  );

comment on column public.bige_contract_payments.installment_count is
  'Number of ECPay installments. Required by current application flows when method is ecpay_installment; legacy rows may be null.';

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

  resolved_signed_on := case
    when p_source_booking_id is not null
      then (now() at time zone 'Asia/Taipei')::date
    else p_signed_on
  end;

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

create or replace function public.bige_record_contract_payment_v2(
  p_contract_id uuid,
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
begin
  if p_method = 'ecpay_installment' then
    if p_installment_count is null or p_installment_count not between 2 and 60 then
      raise exception 'invalid_installment_count';
    end if;
  elsif p_installment_count is not null then
    raise exception 'installment_count_not_allowed';
  end if;

  result := public.bige_record_contract_payment(
    p_contract_id,
    p_schedule_item_id,
    p_payment_kind,
    p_amount,
    p_method,
    p_paid_at,
    p_idempotency_key,
    p_note
  );

  payment_id := (result->>'paymentId')::uuid;

  update public.bige_contract_payments
  set installment_count = p_installment_count
  where id = payment_id
    and (
      installment_count is null
      or installment_count is not distinct from p_installment_count
    );

  if not found then
    raise exception 'idempotency_key_conflict';
  end if;

  return result || jsonb_build_object('installmentCount', p_installment_count);
end;
$$;

revoke all on function public.bige_record_contract_payment_v2(
  uuid, uuid, text, bigint, text, integer, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payment_v2(
  uuid, uuid, text, bigint, text, integer, timestamptz, text, text
) to authenticated;
