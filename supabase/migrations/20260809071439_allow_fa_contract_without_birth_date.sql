begin;

-- FA conversions may create the formal member and contract before a missing
-- birthday is completed. Existing birthdays are preserved when the request
-- does not contain one; name and phone remain required identifiers.

create or replace function public.bige_create_member_contract(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_source_booking_id uuid,
  p_full_name text,
  p_phone text,
  p_birth_date date,
  p_email text,
  p_email_unavailable boolean,
  p_plan_id uuid,
  p_signed_on date,
  p_pin text,
  p_initial_payment bigint,
  p_payment_method text,
  p_payment_schedule jsonb,
  p_future_trial_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  member_row public.members%rowtype;
  plan_row public.member_plan_catalog%rowtype;
  source_booking public.bookings%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  normalized_phone text;
  member_code_value text;
  base_days integer;
  validity_days integer;
  extension_limit integer;
  contract_end timestamptz;
  contract_no text;
  schedule_item jsonb;
  schedule_total bigint := 0;
  schedule_seq integer := 0;
  minimum_deposit bigint;
  unlocked integer := 0;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' or p_phone is null or btrim(p_phone) = '' then
    raise exception 'member_identity_required';
  end if;

  if not p_email_unavailable and (p_email is null or btrim(p_email) = '') then
    raise exception 'email_or_unavailable_required';
  end if;

  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'attendance_pin_must_be_six_digits';
  end if;

  if p_future_trial_action not in ('none', 'convert_to_pt', 'cancel') then
    raise exception 'invalid_future_trial_action';
  end if;

  select * into plan_row
  from public.member_plan_catalog
  where id = p_plan_id
    and tenant_id = p_tenant_id
    and is_active = true
    and fitness_visible = true
    and fitness_plan_kind in ('pt_fixed', 'pt_custom')
  for share;

  if not found then
    raise exception 'fitness_plan_not_found';
  end if;

  if plan_row.total_sessions is null
     or plan_row.price_amount <= 0
     or not public.bige_validate_course_allocations(plan_row.course_allocations, plan_row.total_sessions) then
    raise exception 'fitness_plan_invalid';
  end if;

  if p_source_booking_id is not null then
    select * into source_booking
    from public.bookings
    where id = p_source_booking_id
      and tenant_id = p_tenant_id
      and is_bige_schedule = true
      and operation_kind = 'trial'
      and operation_result = 'completed'
    for update;

    if not found then
      raise exception 'completed_trial_required';
    end if;

    if source_booking.converted_at is not null then
      raise exception 'trial_already_converted';
    end if;

    p_member_id := source_booking.member_id;
  end if;

  normalized_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');

  if p_member_id is not null then
    select * into member_row
    from public.members
    where id = p_member_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'member_not_found';
    end if;
  else
    select * into member_row
    from public.members
    where tenant_id = p_tenant_id
      and (
        phone_normalized = normalized_phone
        or (
          not p_email_unavailable
          and email is not null
          and lower(email) = lower(p_email)
        )
      )
    order by created_at
    limit 1
    for update;

    if found and member_row.member_code is not null then
      raise exception 'existing_member_requires_selection';
    end if;

    if not found then
      insert into public.members (
        tenant_id,
        store_id,
        full_name,
        phone,
        phone_normalized,
        email,
        email_unavailable,
        birth_date,
        status,
        portal_status,
        is_prospect
      ) values (
        p_tenant_id,
        p_branch_id,
        btrim(p_full_name),
        btrim(p_phone),
        normalized_phone,
        case when p_email_unavailable then null else lower(btrim(p_email)) end,
        p_email_unavailable,
        p_birth_date,
        'active',
        'pending_activation',
        false
      )
      returning * into member_row;
    end if;
  end if;

  member_code_value := coalesce(member_row.member_code, public.next_bige_member_code());

  update public.members
  set full_name = btrim(p_full_name),
      phone = btrim(p_phone),
      phone_normalized = normalized_phone,
      email = case when p_email_unavailable then null else lower(btrim(p_email)) end,
      email_unavailable = p_email_unavailable,
      birth_date = coalesce(p_birth_date, member_row.birth_date),
      member_code = member_code_value,
      is_prospect = false,
      status = 'active',
      attendance_pin_hash = crypt(p_pin, gen_salt('bf', 10)),
      attendance_pin_set_at = now(),
      attendance_pin_reset_required = false,
      updated_at = now()
  where id = member_row.id
  returning * into member_row;

  base_days := ceil(plan_row.total_sessions::numeric * 3.5)::integer;
  validity_days := base_days + 30;
  extension_limit := ceil(base_days::numeric / 2)::integer;
  contract_end := ((p_signed_on + validity_days)::timestamp at time zone 'Asia/Taipei');
  contract_no := 'CT-' || to_char(p_signed_on, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.member_plan_contracts (
    tenant_id,
    branch_id,
    member_id,
    plan_catalog_id,
    status,
    starts_at,
    ends_at,
    remaining_uses,
    remaining_sessions,
    note,
    created_by,
    updated_by,
    contract_number,
    signed_on,
    total_sessions,
    total_amount,
    unlocked_sessions,
    used_sessions,
    course_allocations,
    course_used,
    payment_status,
    extension_limit_days,
    extension_used_days,
    original_ends_at,
    source_trial_booking_id,
    converted_from_booking_id
  ) values (
    p_tenant_id,
    p_branch_id,
    member_row.id,
    p_plan_id,
    'pending',
    (p_signed_on::timestamp at time zone 'Asia/Taipei'),
    contract_end,
    null,
    0,
    null,
    actor.id,
    actor.id,
    contract_no,
    p_signed_on,
    plan_row.total_sessions,
    plan_row.price_amount::bigint,
    0,
    0,
    plan_row.course_allocations,
    jsonb_build_object('weight_training', 0, 'relaxation', 0, 'reformer_pilates', 0),
    'unpaid',
    extension_limit,
    0,
    contract_end,
    source_booking.trial_booking_id,
    p_source_booking_id
  )
  returning * into contract_row;

  if jsonb_typeof(coalesce(p_payment_schedule, '[]'::jsonb)) <> 'array' then
    raise exception 'payment_schedule_must_be_array';
  end if;

  for schedule_item in select * from jsonb_array_elements(coalesce(p_payment_schedule, '[]'::jsonb))
  loop
    schedule_seq := schedule_seq + 1;
    if coalesce((schedule_item->>'amount')::bigint, 0) <= 0
       or coalesce(schedule_item->>'kind', '') not in ('deposit', 'balance', 'installment')
       or coalesce(schedule_item->>'dueOn', '') = '' then
      raise exception 'payment_schedule_item_invalid';
    end if;

    schedule_total := schedule_total + (schedule_item->>'amount')::bigint;

    insert into public.bige_contract_payment_schedule (
      tenant_id,
      contract_id,
      sequence_no,
      payment_kind,
      due_on,
      due_amount,
      note,
      created_by
    ) values (
      p_tenant_id,
      contract_row.id,
      schedule_seq,
      schedule_item->>'kind',
      (schedule_item->>'dueOn')::date,
      (schedule_item->>'amount')::bigint,
      nullif(btrim(coalesce(schedule_item->>'note', '')), ''),
      actor.id
    );
  end loop;

  if schedule_seq > 0 and schedule_total <> contract_row.total_amount then
    raise exception 'payment_schedule_total_mismatch';
  end if;

  if p_initial_payment > 0 then
    minimum_deposit := ceil(contract_row.total_amount::numeric / contract_row.total_sessions)::bigint;
    if p_initial_payment < minimum_deposit then
      raise exception 'minimum_deposit_not_met';
    end if;
    if p_payment_method not in ('cash', 'bank_transfer', 'card_terminal', 'acpay', 'other') then
      raise exception 'invalid_payment_method';
    end if;

    insert into public.bige_contract_payments (
      tenant_id,
      contract_id,
      payment_kind,
      amount,
      method,
      status,
      paid_at,
      idempotency_key,
      recorded_by
    ) values (
      p_tenant_id,
      contract_row.id,
      'deposit',
      p_initial_payment,
      p_payment_method,
      'recorded',
      now(),
      'contract-create:' || contract_row.id::text,
      actor.id
    );

    unlocked := least(
      contract_row.total_sessions,
      floor(p_initial_payment::numeric * contract_row.total_sessions / contract_row.total_amount)::integer
    );

    update public.member_plan_contracts
    set unlocked_sessions = unlocked,
        remaining_sessions = unlocked,
        status = case when unlocked > 0 then 'active' else 'pending' end,
        payment_status = case
          when p_initial_payment >= contract_row.total_amount then 'settled'
          else 'deposit_paid'
        end,
        updated_by = actor.id,
        updated_at = now()
    where id = contract_row.id
    returning * into contract_row;

    if unlocked > 0 then
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
        p_tenant_id,
        p_branch_id,
        member_row.id,
        contract_row.id,
        'grant',
        unlocked,
        unlocked,
        'contract_payment',
        contract_row.id::text,
        'initial_payment_unlock',
        jsonb_build_object('amount', p_initial_payment),
        actor.id
      );
    end if;
  end if;

  if p_source_booking_id is not null then
    update public.bookings
    set converted_at = now(),
        converted_contract_id = contract_row.id,
        updated_at = now()
    where id = p_source_booking_id;

    if p_future_trial_action = 'convert_to_pt' then
      update public.bookings
      set operation_kind = 'pt',
          trial_stage = null,
          member_plan_contract_id = contract_row.id,
          updated_at = now()
      where member_id = member_row.id
        and is_bige_schedule = true
        and operation_kind = 'trial'
        and status in ('pending', 'confirmed', 'booked', 'checked_in')
        and starts_at > now()
        and id <> p_source_booking_id;
    elsif p_future_trial_action = 'cancel' then
      update public.bookings
      set status = 'cancelled',
          operation_result = 'cancelled',
          cancelled_at = now(),
          status_reason = 'converted_member_future_trial_cancelled',
          updated_at = now()
      where member_id = member_row.id
        and is_bige_schedule = true
        and operation_kind = 'trial'
        and status in ('pending', 'confirmed', 'booked', 'checked_in')
        and starts_at > now()
        and id <> p_source_booking_id;
    end if;

    update public.crm_leads
    set status = 'won',
        trial_result = 'won',
        won_member_id = member_row.id,
        won_plan_code = plan_row.code,
        updated_by = actor.id,
        updated_at = now()
    where tenant_id = p_tenant_id
      and trial_booking_id = source_booking.trial_booking_id;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id,
    actor.id,
    case when p_source_booking_id is null then 'direct_member_contract_created' else 'trial_converted_to_member' end,
    'member_plan_contract',
    contract_row.id::text,
    null,
    jsonb_build_object(
      'memberId', member_row.id,
      'memberCode', member_row.member_code,
      'planId', p_plan_id,
      'totalSessions', contract_row.total_sessions,
      'totalAmount', contract_row.total_amount,
      'signedOn', p_signed_on,
      'endsAt', contract_row.ends_at,
      'initialPayment', p_initial_payment
    )
  );

  return jsonb_build_object(
    'memberId', member_row.id,
    'memberCode', member_row.member_code,
    'contractId', contract_row.id,
    'contractNumber', contract_row.contract_number,
    'status', contract_row.status,
    'paymentStatus', contract_row.payment_status,
    'unlockedSessions', contract_row.unlocked_sessions,
    'endsAt', contract_row.ends_at
  );
end;
$$;

revoke all on function public.bige_create_member_contract(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, uuid, date, text,
  bigint, text, jsonb, text
) from public, anon;
grant execute on function public.bige_create_member_contract(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, uuid, date, text,
  bigint, text, jsonb, text
) to authenticated;

commit;
