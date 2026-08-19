-- Keep every tender as an auditable payment row while applying the aggregate
-- receipt to contract unlocking exactly once. The source booking link powers
-- the manager/assistant-manager amount badge on future schedule entries.

alter table public.bige_contract_payments
  add column if not exists source_booking_id uuid references public.bookings(id) on delete set null;

create index if not exists bige_contract_payments_source_booking_idx
  on public.bige_contract_payments(tenant_id, source_booking_id, paid_at desc)
  where source_booking_id is not null and status = 'recorded';

comment on column public.bige_contract_payments.source_booking_id is
  'Schedule booking where this receipt was recorded. Multiple tender rows may point to the same booking.';

create or replace function public.bige_record_contract_payments_v1(
  p_contract_id uuid,
  p_source_booking_id uuid,
  p_schedule_item_id uuid,
  p_payment_kind text,
  p_payments jsonb,
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
  actor public.profiles%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  entry jsonb;
  entry_index integer;
  entry_count integer;
  existing_count integer;
  existing_mismatch_count integer;
  total_amount bigint := 0;
  entry_amount bigint;
  entry_method text;
  entry_installment_count integer;
  first_method text;
  first_amount bigint;
  first_installment_count integer;
  base_result jsonb;
  first_payment_id uuid;
  payment_ids jsonb;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;

  if not found
     or not (
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

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'payment_entries_invalid';
  end if;
  entry_count := jsonb_array_length(p_payments);
  if entry_count < 1 or entry_count > 10 then
    raise exception 'payment_entries_invalid';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'idempotency_key_required';
  end if;

  for entry, entry_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_payments) with ordinality
  loop
    begin
      entry_amount := (entry->>'amount')::bigint;
      entry_installment_count := nullif(entry->>'installmentCount', '')::integer;
    exception when others then
      raise exception 'payment_entries_invalid';
    end;
    entry_method := entry->>'method';
    if entry_amount <= 0 then
      raise exception 'payment_amount_invalid';
    end if;
    if entry_method not in (
      'cash', 'bank_transfer', 'card_terminal', 'ecpay', 'ecpay_installment', 'acpay', 'other'
    ) then
      raise exception 'payment_method_invalid';
    end if;
    if entry_method = 'ecpay_installment' then
      if entry_installment_count is null or entry_installment_count not between 2 and 60 then
        raise exception 'invalid_installment_count';
      end if;
    elsif entry_installment_count is not null then
      raise exception 'installment_count_not_allowed';
    end if;
    total_amount := total_amount + entry_amount;
    if entry_index = 1 then
      first_amount := entry_amount;
      first_method := entry_method;
      first_installment_count := entry_installment_count;
    end if;
  end loop;

  select * into contract_row
  from public.member_plan_contracts
  where id = p_contract_id
  for update;
  if not found or contract_row.total_sessions is null or contract_row.total_amount is null then
    raise exception 'fitness_contract_not_found';
  end if;
  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from contract_row.tenant_id then
    raise exception 'forbidden';
  end if;
  if p_source_booking_id is not null and not exists (
    select 1
    from public.bookings booking
    where booking.id = p_source_booking_id
      and booking.tenant_id = contract_row.tenant_id
      and booking.member_id = contract_row.member_id
      and booking.is_bige_schedule = true
  ) then
    raise exception 'payment_source_booking_invalid';
  end if;

  select count(*) into existing_count
  from public.bige_contract_payments payment
  where payment.tenant_id = contract_row.tenant_id
    and left(payment.idempotency_key, length(btrim(p_idempotency_key)) + 1)
      = btrim(p_idempotency_key) || ':';
  if existing_count > 0 then
    select count(*) into existing_mismatch_count
    from jsonb_array_elements(p_payments) with ordinality entries(entry, sequence_no)
    left join public.bige_contract_payments payment
      on payment.tenant_id = contract_row.tenant_id
     and payment.idempotency_key = btrim(p_idempotency_key) || ':' || entries.sequence_no::text
    where payment.id is null
       or payment.contract_id is distinct from contract_row.id
       or payment.schedule_item_id is distinct from p_schedule_item_id
       or payment.source_booking_id is distinct from p_source_booking_id
       or payment.payment_kind is distinct from p_payment_kind
       or payment.amount is distinct from (entries.entry->>'amount')::bigint
       or payment.method is distinct from entries.entry->>'method'
       or payment.installment_count is distinct from nullif(entries.entry->>'installmentCount', '')::integer;

    if existing_count <> entry_count or existing_mismatch_count > 0 then
      raise exception 'idempotency_key_conflict';
    end if;

    select jsonb_agg(payment.id order by entries.sequence_no) into payment_ids
    from jsonb_array_elements(p_payments) with ordinality entries(entry, sequence_no)
    join public.bige_contract_payments payment
      on payment.tenant_id = contract_row.tenant_id
     and payment.idempotency_key = btrim(p_idempotency_key) || ':' || entries.sequence_no::text;
    return jsonb_build_object(
      'paymentIds', coalesce(payment_ids, '[]'::jsonb),
      'contractId', contract_row.id,
      'totalPaid', (
        select coalesce(sum(amount), 0)::bigint
        from public.bige_contract_payments
        where contract_id = contract_row.id and status = 'recorded'
      ),
      'unlockedSessions', contract_row.unlocked_sessions,
      'remainingSessions', contract_row.remaining_sessions,
      'paymentStatus', contract_row.payment_status,
      'replayed', true
    );
  end if;

  -- The established RPC performs the aggregate balance, minimum-deposit,
  -- schedule and unlock mutation. We then split the placeholder receipt in the
  -- same transaction, so a failure rolls every row and unlock back together.
  base_result := public.bige_record_contract_payment_v2(
    p_contract_id,
    p_schedule_item_id,
    p_payment_kind,
    total_amount,
    'other',
    null,
    p_paid_at,
    btrim(p_idempotency_key) || ':1',
    p_note
  );
  first_payment_id := (base_result->>'paymentId')::uuid;

  update public.bige_contract_payments
  set amount = first_amount,
      method = first_method,
      installment_count = first_installment_count,
      source_booking_id = p_source_booking_id
  where id = first_payment_id;
  if not found then
    raise exception 'contract_initial_payment_not_found';
  end if;

  for entry, entry_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_payments) with ordinality
  loop
    if entry_index = 1 then continue; end if;
    insert into public.bige_contract_payments (
      tenant_id, contract_id, schedule_item_id, source_booking_id,
      payment_kind, amount, method, installment_count, status, paid_at,
      idempotency_key, note, recorded_by
    ) values (
      contract_row.tenant_id,
      contract_row.id,
      p_schedule_item_id,
      p_source_booking_id,
      p_payment_kind,
      (entry->>'amount')::bigint,
      entry->>'method',
      nullif(entry->>'installmentCount', '')::integer,
      'recorded',
      coalesce(p_paid_at, now()),
      btrim(p_idempotency_key) || ':' || entry_index::text,
      nullif(btrim(coalesce(p_note, '')), ''),
      actor.id
    );
  end loop;

  select jsonb_agg(payment.id order by sequence_no) into payment_ids
  from generate_series(1, entry_count) as sequence_rows(sequence_no)
  join public.bige_contract_payments payment
    on payment.tenant_id = contract_row.tenant_id
   and payment.idempotency_key = btrim(p_idempotency_key) || ':' || sequence_no::text;

  update public.audit_logs
  set payload = payload || jsonb_build_object(
    'amount', total_amount,
    'method', case when entry_count > 1 then 'split' else first_method end,
    'paymentIds', payment_ids,
    'paymentEntries', p_payments,
    'sourceBookingId', p_source_booking_id
  )
  where target_type = 'bige_contract_payment'
    and target_id = first_payment_id::text
    and action = 'fitness_contract_payment_recorded';

  return base_result || jsonb_build_object(
    'paymentIds', coalesce(payment_ids, '[]'::jsonb),
    'totalAmount', total_amount,
    'sourceBookingId', p_source_booking_id
  );
end;
$$;

revoke all on function public.bige_record_contract_payments_v1(
  uuid, uuid, uuid, text, jsonb, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payments_v1(
  uuid, uuid, uuid, text, jsonb, timestamptz, text, text
) to authenticated;

create or replace function public.bige_create_member_contract_v6(
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
  p_payment_source_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
  payment_row public.bige_contract_payments%rowtype;
  entry jsonb;
  entry_index integer;
  entry_count integer := 0;
  entry_amount bigint;
  entry_method text;
  entry_installment_count integer;
  payment_total bigint := 0;
  payment_ids jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'payment_entries_invalid';
  end if;
  entry_count := jsonb_array_length(coalesce(p_payments, '[]'::jsonb));
  if entry_count > 10 or (p_initial_payment > 0 and entry_count = 0) then
    raise exception 'payment_entries_invalid';
  end if;

  for entry, entry_index in
    select value, ordinality::integer
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality
  loop
    begin
      entry_amount := (entry->>'amount')::bigint;
      entry_installment_count := nullif(entry->>'installmentCount', '')::integer;
    exception when others then
      raise exception 'payment_entries_invalid';
    end;
    entry_method := entry->>'method';
    if entry_amount <= 0 then raise exception 'payment_amount_invalid'; end if;
    if entry_method not in (
      'cash', 'bank_transfer', 'card_terminal', 'ecpay', 'ecpay_installment', 'acpay', 'other'
    ) then raise exception 'payment_method_invalid'; end if;
    if entry_method = 'ecpay_installment' then
      if entry_installment_count is null or entry_installment_count not between 2 and 60 then
        raise exception 'invalid_installment_count';
      end if;
    elsif entry_installment_count is not null then
      raise exception 'installment_count_not_allowed';
    end if;
    payment_total := payment_total + entry_amount;
  end loop;
  if payment_total <> p_initial_payment then
    raise exception 'payment_entries_total_mismatch';
  end if;

  contract_result := public.bige_create_member_contract_v5(
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
    case when p_initial_payment > 0 then 'other' else null end,
    null,
    p_payment_schedule,
    p_future_trial_action,
    p_fa_fee_recipient_profile_id,
    p_fa_fee_recipient_name,
    p_sales_origin_coach_id,
    p_sales_origin_kind
  );

  created_contract_id := (contract_result->>'contractId')::uuid;
  created_member_id := (contract_result->>'memberId')::uuid;
  if p_payment_source_booking_id is not null and not exists (
    select 1
    from public.bookings booking
    where booking.id = p_payment_source_booking_id
      and booking.tenant_id = p_tenant_id
      and booking.member_id = created_member_id
      and booking.is_bige_schedule = true
  ) then
    raise exception 'payment_source_booking_invalid';
  end if;

  if p_initial_payment > 0 then
    select * into payment_row
    from public.bige_contract_payments
    where tenant_id = p_tenant_id
      and contract_id = created_contract_id
      and idempotency_key = 'contract-create:' || created_contract_id::text
    for update;
    if not found then raise exception 'contract_initial_payment_not_found'; end if;

    for entry, entry_index in
      select value, ordinality::integer
      from jsonb_array_elements(p_payments) with ordinality
    loop
      if entry_index = 1 then
        update public.bige_contract_payments
        set amount = (entry->>'amount')::bigint,
            method = entry->>'method',
            installment_count = nullif(entry->>'installmentCount', '')::integer,
            source_booking_id = p_payment_source_booking_id
        where id = payment_row.id;
      else
        insert into public.bige_contract_payments (
          tenant_id, contract_id, source_booking_id, payment_kind, amount,
          method, installment_count, status, paid_at, idempotency_key,
          recorded_by
        ) values (
          p_tenant_id,
          created_contract_id,
          p_payment_source_booking_id,
          'deposit',
          (entry->>'amount')::bigint,
          entry->>'method',
          nullif(entry->>'installmentCount', '')::integer,
          'recorded',
          payment_row.paid_at,
          'contract-create:' || created_contract_id::text || ':' || entry_index::text,
          payment_row.recorded_by
        );
      end if;
    end loop;

    select jsonb_agg(payment.id order by payment.created_at, payment.id) into payment_ids
    from public.bige_contract_payments payment
    where payment.tenant_id = p_tenant_id
      and payment.contract_id = created_contract_id
      and payment.status = 'recorded';
  end if;

  return contract_result || jsonb_build_object(
    'paymentIds', coalesce(payment_ids, '[]'::jsonb),
    'paymentSourceBookingId', p_payment_source_booking_id
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v6(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text, uuid
) from public, anon;
grant execute on function public.bige_create_member_contract_v6(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text, uuid
) to authenticated;
