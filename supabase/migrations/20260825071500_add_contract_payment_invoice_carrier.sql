begin;

alter table public.bige_contract_payments
  add column if not exists invoice_carrier text,
  add column if not exists invoice_carrier_pending boolean not null default false;

alter table public.bige_contract_payments
  drop constraint if exists bige_contract_payments_invoice_carrier_format;
alter table public.bige_contract_payments
  add constraint bige_contract_payments_invoice_carrier_format
  check (
    invoice_carrier is null
    or invoice_carrier ~ '^[A-Z0-9+./-]{1,80}$'
  );

alter table public.bige_contract_payments
  drop constraint if exists bige_contract_payments_invoice_carrier_pending_check;
alter table public.bige_contract_payments
  add constraint bige_contract_payments_invoice_carrier_pending_check
  check (not invoice_carrier_pending or invoice_carrier is null);

comment on column public.bige_contract_payments.invoice_carrier is
  'Invoice carrier captured for this payment. ASCII letters are stored uppercase.';
comment on column public.bige_contract_payments.invoice_carrier_pending is
  'True when payment was completed before the invoice carrier was available.';

create or replace function public.bige_apply_payment_invoice_metadata_v1(
  p_payment_ids jsonb,
  p_invoice_carrier text,
  p_invoice_carrier_pending boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  normalized_carrier text := nullif(upper(btrim(coalesce(p_invoice_carrier, ''))), '');
  expected_count integer := jsonb_array_length(coalesce(p_payment_ids, '[]'::jsonb));
  updated_count integer := 0;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found then raise exception 'forbidden'; end if;

  if coalesce(p_invoice_carrier_pending, false) then
    if normalized_carrier is not null then
      raise exception 'invoice_carrier_pending_conflict';
    end if;
  elsif normalized_carrier is null then
    raise exception 'invoice_carrier_required';
  end if;

  if normalized_carrier is not null
     and normalized_carrier !~ '^[A-Z0-9+./-]{1,80}$' then
    raise exception 'invoice_carrier_invalid';
  end if;

  update public.bige_contract_payments payment
  set invoice_carrier = normalized_carrier,
      invoice_carrier_pending = coalesce(p_invoice_carrier_pending, false)
  where payment.tenant_id = actor.tenant_id
    and payment.id in (
      select value::text::uuid
      from jsonb_array_elements_text(coalesce(p_payment_ids, '[]'::jsonb))
    );
  get diagnostics updated_count = row_count;

  if updated_count <> expected_count then
    raise exception 'payment_not_found';
  end if;
end;
$$;

revoke all on function public.bige_apply_payment_invoice_metadata_v1(jsonb, text, boolean)
  from public, anon, authenticated;

create or replace function public.bige_record_contract_payments_v2(
  p_contract_id uuid,
  p_source_booking_id uuid,
  p_schedule_item_id uuid,
  p_payment_kind text,
  p_payments jsonb,
  p_paid_at timestamptz,
  p_idempotency_key text,
  p_note text,
  p_invoice_carrier text,
  p_invoice_carrier_pending boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_result jsonb;
begin
  payment_result := public.bige_record_contract_payments_v1(
    p_contract_id,
    p_source_booking_id,
    p_schedule_item_id,
    p_payment_kind,
    p_payments,
    p_paid_at,
    p_idempotency_key,
    p_note
  );
  perform public.bige_apply_payment_invoice_metadata_v1(
    payment_result->'paymentIds',
    p_invoice_carrier,
    p_invoice_carrier_pending
  );
  return payment_result || jsonb_build_object(
    'invoiceCarrier', nullif(upper(btrim(coalesce(p_invoice_carrier, ''))), ''),
    'invoiceCarrierPending', coalesce(p_invoice_carrier_pending, false)
  );
end;
$$;

revoke all on function public.bige_record_contract_payments_v2(
  uuid, uuid, uuid, text, jsonb, timestamptz, text, text, text, boolean
) from public, anon;
grant execute on function public.bige_record_contract_payments_v2(
  uuid, uuid, uuid, text, jsonb, timestamptz, text, text, text, boolean
) to authenticated;

create or replace function public.bige_create_member_contract_v9(
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
  p_payments jsonb,
  p_payment_schedule jsonb,
  p_future_trial_action text,
  p_fa_fee_recipient_profile_id uuid,
  p_fa_fee_recipient_name text,
  p_sales_origin_coach_id uuid,
  p_sales_origin_kind text,
  p_payment_source_booking_id uuid,
  p_line_binding_id uuid,
  p_walk_in boolean,
  p_walk_in_idempotency_key text,
  p_invoice_carrier text,
  p_invoice_carrier_pending boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
begin
  contract_result := public.bige_create_member_contract_v8(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule,
    p_future_trial_action, p_fa_fee_recipient_profile_id,
    p_fa_fee_recipient_name, p_sales_origin_coach_id,
    p_sales_origin_kind, p_payment_source_booking_id,
    p_line_binding_id, p_walk_in, p_walk_in_idempotency_key
  );
  perform public.bige_apply_payment_invoice_metadata_v1(
    contract_result->'paymentIds',
    p_invoice_carrier,
    p_invoice_carrier_pending
  );
  return contract_result || jsonb_build_object(
    'invoiceCarrier', nullif(upper(btrim(coalesce(p_invoice_carrier, ''))), ''),
    'invoiceCarrierPending', coalesce(p_invoice_carrier_pending, false)
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v9(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text, text, boolean
) from public, anon;
grant execute on function public.bige_create_member_contract_v9(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text, text, boolean
) to authenticated;

create or replace function public.bige_create_bb_member_contract_v4(
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
  p_payments jsonb,
  p_payment_schedule jsonb,
  p_line_binding_id uuid,
  p_invoice_carrier text,
  p_invoice_carrier_pending boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
begin
  contract_result := public.bige_create_bb_member_contract_v3(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule, p_line_binding_id
  );
  perform public.bige_apply_payment_invoice_metadata_v1(
    contract_result->'paymentIds',
    p_invoice_carrier,
    p_invoice_carrier_pending
  );
  return contract_result || jsonb_build_object(
    'invoiceCarrier', nullif(upper(btrim(coalesce(p_invoice_carrier, ''))), ''),
    'invoiceCarrierPending', coalesce(p_invoice_carrier_pending, false)
  );
end;
$$;

revoke all on function public.bige_create_bb_member_contract_v4(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid, text, boolean
) from public, anon;
grant execute on function public.bige_create_bb_member_contract_v4(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid, text, boolean
) to authenticated;

commit;
