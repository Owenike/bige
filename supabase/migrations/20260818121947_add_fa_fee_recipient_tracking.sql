begin;

alter table public.bookings
  add column if not exists fa_fee_amount integer,
  add column if not exists fa_fee_recipient_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists fa_fee_recipient_name text,
  add column if not exists fa_fee_recorded_by uuid references public.profiles(id) on delete set null,
  add column if not exists fa_fee_recorded_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_fa_fee_amount_check;
alter table public.bookings
  add constraint bookings_fa_fee_amount_check
  check (fa_fee_amount is null or fa_fee_amount in (880, 1500));

alter table public.bookings
  drop constraint if exists bookings_fa_fee_recipient_name_check;
alter table public.bookings
  add constraint bookings_fa_fee_recipient_name_check
  check (
    fa_fee_recipient_name is null
    or char_length(btrim(fa_fee_recipient_name)) between 1 and 80
  );

create index if not exists bookings_fa_fee_recipient_profile_idx
  on public.bookings(tenant_id, fa_fee_recipient_profile_id, fa_fee_recorded_at desc)
  where fa_fee_recipient_profile_id is not null;

comment on column public.bookings.fa_fee_amount is
  'FA fee inferred from the linked trial service: 1500 TWD for sports massage, otherwise 880 TWD.';
comment on column public.bookings.fa_fee_recipient_profile_id is
  'Selected active employee receiving the FA fee; null when a free-text recipient is entered.';
comment on column public.bookings.fa_fee_recipient_name is
  'Immutable display label or free-text recipient captured when the FA result/payment is finalized.';

create or replace function public.bige_store_fa_fee_recipient_internal(
  p_booking_id uuid,
  p_recipient_profile_id uuid,
  p_recipient_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_row public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  recipient_row public.profiles%rowtype;
  trial_service text;
  resolved_recipient_name text;
  resolved_amount integer;
begin
  select * into actor_row
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

  if actor_row.role <> 'platform_admin'
     and actor_row.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  resolved_recipient_name := btrim(coalesce(p_recipient_name, ''));
  if resolved_recipient_name = '' or char_length(resolved_recipient_name) > 80 then
    raise exception 'fa_fee_recipient_invalid';
  end if;

  if p_recipient_profile_id is not null then
    select * into recipient_row
    from public.profiles
    where id = p_recipient_profile_id
      and tenant_id = booking_row.tenant_id
      and is_active = true;

    if not found then
      raise exception 'fa_fee_recipient_profile_invalid';
    end if;

    resolved_recipient_name := coalesce(
      nullif(btrim(recipient_row.english_name), ''),
      nullif(btrim(recipient_row.display_name), ''),
      nullif(btrim(recipient_row.employee_number), '')
    );
    if resolved_recipient_name is null then
      raise exception 'fa_fee_recipient_profile_invalid';
    end if;
    if nullif(btrim(recipient_row.employee_number), '') is not null
       and resolved_recipient_name <> btrim(recipient_row.employee_number) then
      resolved_recipient_name := resolved_recipient_name || '｜' || btrim(recipient_row.employee_number);
    end if;
  end if;

  select service into trial_service
  from public.trial_bookings
  where id = booking_row.trial_booking_id;

  resolved_amount := case when trial_service = 'sports_massage' then 1500 else 880 end;

  update public.bookings
  set fa_fee_amount = resolved_amount,
      fa_fee_recipient_profile_id = p_recipient_profile_id,
      fa_fee_recipient_name = resolved_recipient_name,
      fa_fee_recorded_by = actor_row.id,
      fa_fee_recorded_at = now(),
      updated_at = now()
  where id = booking_row.id;

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
    'bige_fa_fee_recipient_recorded',
    'booking',
    booking_row.id::text,
    resolved_recipient_name,
    jsonb_build_object(
      'amount', resolved_amount,
      'recipientProfileId', p_recipient_profile_id,
      'recipientName', resolved_recipient_name,
      'trialBookingId', booking_row.trial_booking_id,
      'trialService', trial_service
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'amount', resolved_amount,
    'recipientProfileId', p_recipient_profile_id,
    'recipientName', resolved_recipient_name
  );
end;
$$;

revoke all on function public.bige_store_fa_fee_recipient_internal(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.bige_complete_trial_outcome_v2(
  p_booking_id uuid,
  p_outcome text,
  p_fa_fee_recipient_profile_id uuid,
  p_fa_fee_recipient_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outcome_result jsonb;
  fee_result jsonb := null;
begin
  outcome_result := public.bige_complete_trial_outcome(p_booking_id, p_outcome);

  if p_outcome = 'not_converted' then
    fee_result := public.bige_store_fa_fee_recipient_internal(
      p_booking_id,
      p_fa_fee_recipient_profile_id,
      p_fa_fee_recipient_name
    );
  elsif p_fa_fee_recipient_profile_id is not null or p_fa_fee_recipient_name is not null then
    raise exception 'fa_fee_recipient_not_allowed';
  end if;

  return outcome_result || jsonb_build_object('faFee', fee_result);
end;
$$;

revoke all on function public.bige_complete_trial_outcome_v2(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.bige_complete_trial_outcome_v2(uuid, text, uuid, text)
  to authenticated;

create or replace function public.bige_create_member_contract_v4(
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
  p_future_trial_action text,
  p_fa_fee_recipient_profile_id uuid,
  p_fa_fee_recipient_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
  fee_result jsonb := null;
begin
  contract_result := public.bige_create_member_contract_v3(
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
    p_signed_on,
    p_pin,
    p_initial_payment,
    p_payment_method,
    p_installment_count,
    p_payment_schedule,
    p_future_trial_action
  );

  if p_source_booking_id is not null then
    fee_result := public.bige_store_fa_fee_recipient_internal(
      p_source_booking_id,
      p_fa_fee_recipient_profile_id,
      p_fa_fee_recipient_name
    );
  elsif p_fa_fee_recipient_profile_id is not null or p_fa_fee_recipient_name is not null then
    raise exception 'fa_fee_recipient_not_allowed';
  end if;

  return contract_result || jsonb_build_object('faFee', fee_result);
end;
$$;

revoke all on function public.bige_create_member_contract_v4(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v4(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text
) to authenticated;

commit;
