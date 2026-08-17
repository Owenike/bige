begin;

-- Contract creation is available to every active employee except employee 06.
-- Refunds, voids and extensions remain restricted to coaching managers and
-- assistant managers, with platform admin and legacy manager equivalents kept.

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

  if not found
     or actor.employee_number is null
     or upper(actor.employee_number) !~ '^E[0-9]{6}$'
     or upper(actor.employee_number) = 'E000006' then
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

create or replace function public.bige_create_member_contract_v2(
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
  resolved_plan_id uuid := p_plan_id;
  custom_plan_id uuid;
  custom_name text;
  custom_description text;
  custom_total_sessions integer;
  custom_total_amount bigint;
  custom_allocations jsonb;
  custom_validity_days integer;
  custom_extension_limit_days integer;
  custom_ends_at timestamptz;
  result jsonb;
  contract_id uuid;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found
     or actor.employee_number is null
     or upper(actor.employee_number) !~ '^E[0-9]{6}$'
     or upper(actor.employee_number) = 'E000006' then
    raise exception 'forbidden';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;

  if p_plan_mode not in ('builtin', 'custom') then
    raise exception 'invalid_contract_plan_mode';
  end if;

  if p_plan_mode = 'custom' then
    if jsonb_typeof(coalesce(p_custom_plan, '{}'::jsonb)) <> 'object' then
      raise exception 'custom_plan_invalid';
    end if;

    custom_name := btrim(coalesce(p_custom_plan->>'name', ''));
    custom_description := nullif(btrim(coalesce(p_custom_plan->>'description', '')), '');
    custom_total_sessions := coalesce((p_custom_plan->>'totalSessions')::integer, 0);
    custom_total_amount := coalesce((p_custom_plan->>'totalAmount')::bigint, 0);
    custom_allocations := coalesce(p_custom_plan->'allocations', '{}'::jsonb);
    custom_validity_days := coalesce((p_custom_plan->>'validityDays')::integer, 0);
    custom_extension_limit_days := coalesce((p_custom_plan->>'extensionLimitDays')::integer, 0);

    if custom_name = ''
       or custom_total_sessions <= 0
       or custom_total_amount <= 0
       or custom_validity_days <= 0
       or custom_extension_limit_days < 0
       or not public.bige_validate_course_allocations(custom_allocations, custom_total_sessions) then
      raise exception 'custom_plan_invalid';
    end if;

    insert into public.member_plan_catalog (
      tenant_id,
      branch_id,
      code,
      name,
      description,
      plan_type,
      fulfillment_kind,
      default_duration_days,
      default_quantity,
      service_scope,
      price_amount,
      is_active,
      fitness_plan_kind,
      total_sessions,
      course_allocations,
      validity_bonus_days,
      fitness_visible,
      metadata,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_branch_id,
      'fitness_custom_' || replace(gen_random_uuid()::text, '-', ''),
      custom_name,
      custom_description,
      'coach_pack',
      'none',
      custom_validity_days,
      custom_total_sessions,
      (
        select coalesce(jsonb_agg(key), '[]'::jsonb)
        from jsonb_each_text(custom_allocations)
        where value::integer > 0
      ),
      custom_total_amount,
      true,
      'pt_custom',
      custom_total_sessions,
      custom_allocations,
      0,
      true,
      jsonb_build_object(
        'contractOnly', true,
        'validityDays', custom_validity_days,
        'extensionLimitDays', custom_extension_limit_days
      ),
      actor.id,
      actor.id
    )
    returning id into custom_plan_id;

    resolved_plan_id := custom_plan_id;
  elsif resolved_plan_id is null then
    raise exception 'fitness_plan_not_found';
  end if;

  result := public.bige_create_member_contract(
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_source_booking_id,
    p_full_name,
    p_phone,
    p_birth_date,
    p_email,
    p_email_unavailable,
    resolved_plan_id,
    p_signed_on,
    p_pin,
    p_initial_payment,
    p_payment_method,
    p_payment_schedule,
    p_future_trial_action
  );

  if p_plan_mode = 'custom' then
    contract_id := (result->>'contractId')::uuid;
    custom_ends_at := ((p_signed_on + custom_validity_days)::timestamp at time zone 'Asia/Taipei');

    update public.member_plan_contracts
    set ends_at = custom_ends_at,
        original_ends_at = custom_ends_at,
        extension_limit_days = custom_extension_limit_days,
        updated_by = actor.id,
        updated_at = now()
    where id = contract_id
      and tenant_id = p_tenant_id;

    update public.member_plan_catalog
    set is_active = false,
        fitness_visible = false,
        updated_by = actor.id,
        updated_at = now()
    where id = custom_plan_id;

    insert into public.audit_logs (
      tenant_id,
      actor_id,
      action,
      target_type,
      target_id,
      reason,
      payload
    ) values (
      p_tenant_id,
      actor.id,
      'bige_custom_contract_terms_applied',
      'member_plan_contract',
      contract_id::text,
      'custom_plan',
      jsonb_build_object(
        'planId', custom_plan_id,
        'validityDays', custom_validity_days,
        'extensionLimitDays', custom_extension_limit_days,
        'endsAt', custom_ends_at
      )
    );

    result := result || jsonb_build_object(
      'planMode', 'custom',
      'planId', custom_plan_id,
      'endsAt', custom_ends_at,
      'extensionLimitDays', custom_extension_limit_days
    );
  else
    result := result || jsonb_build_object('planMode', 'builtin', 'planId', resolved_plan_id);
  end if;

  return result;
end;
$$;

revoke all on function public.bige_create_member_contract_v2(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, jsonb, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v2(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, jsonb, text
) to authenticated;

create or replace function public.bige_extend_contract(
  p_contract_id uuid,
  p_extension_days integer,
  p_reason text,
  p_signature_path text,
  p_signature_statement text,
  p_signed_member_name text,
  p_signed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  old_end timestamptz;
  new_end timestamptz;
  new_cumulative integer;
  expiry_date date;
  base_date date;
  extension_row public.bige_contract_extensions%rowtype;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

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

  if p_extension_days <= 0
     or btrim(coalesce(p_reason, '')) = ''
     or btrim(coalesce(p_signature_path, '')) = ''
     or btrim(coalesce(p_signature_statement, '')) = ''
     or btrim(coalesce(p_signed_member_name, '')) = ''
     or p_signed_at is null then
    raise exception 'extension_signature_and_reason_required';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = p_contract_id
  for update;

  if not found or contract_row.total_sessions is null then
    raise exception 'fitness_contract_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from contract_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if coalesce(contract_row.remaining_sessions, 0) <= 0 then
    raise exception 'no_remaining_sessions_to_extend';
  end if;

  old_end := contract_row.ends_at;
  expiry_date := ((old_end at time zone 'Asia/Taipei')::date - 1);

  if current_date < expiry_date - 30 then
    raise exception 'extension_window_not_open';
  end if;

  new_cumulative := contract_row.extension_used_days + p_extension_days;
  if new_cumulative > contract_row.extension_limit_days then
    raise exception 'extension_limit_exceeded';
  end if;

  base_date := greatest(expiry_date, current_date);
  new_end := ((base_date + p_extension_days + 1)::timestamp at time zone 'Asia/Taipei');

  insert into public.bige_contract_extensions (
    tenant_id,
    contract_id,
    old_ends_at,
    new_ends_at,
    extension_days,
    cumulative_extension_days,
    reason,
    signature_path,
    signature_statement,
    signed_member_name,
    signed_at,
    approved_by
  ) values (
    contract_row.tenant_id,
    contract_row.id,
    old_end,
    new_end,
    p_extension_days,
    new_cumulative,
    btrim(p_reason),
    btrim(p_signature_path),
    p_signature_statement,
    btrim(p_signed_member_name),
    p_signed_at,
    actor.id
  )
  returning * into extension_row;

  update public.member_plan_contracts
  set ends_at = new_end,
      extension_used_days = new_cumulative,
      status = case
        when unlocked_sessions > used_sessions then 'active'
        else 'pending'
      end,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    contract_row.tenant_id,
    actor.id,
    'fitness_contract_extended',
    'member_plan_contract',
    contract_row.id::text,
    btrim(p_reason),
    jsonb_build_object(
      'extensionId', extension_row.id,
      'oldEndsAt', old_end,
      'newEndsAt', new_end,
      'extensionDays', p_extension_days,
      'cumulativeExtensionDays', new_cumulative,
      'signaturePath', p_signature_path
    )
  );

  return jsonb_build_object(
    'extensionId', extension_row.id,
    'contractId', contract_row.id,
    'oldEndsAt', old_end,
    'newEndsAt', new_end,
    'extensionDays', p_extension_days,
    'cumulativeExtensionDays', new_cumulative,
    'extensionLimitDays', contract_row.extension_limit_days
  );
end;
$$;

revoke all on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) from public, anon;
grant execute on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) to authenticated;

create or replace function public.bige_reverse_contract_payment(
  p_payment_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  payment_row public.bige_contract_payments%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  total_paid bigint;
  previous_unlocked integer;
  next_unlocked integer;
  next_status text;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

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

  if p_action not in ('void', 'refund') or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'payment_reversal_reason_required';
  end if;

  select * into payment_row
  from public.bige_contract_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from payment_row.tenant_id then
    raise exception 'forbidden';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = payment_row.contract_id
  for update;

  if payment_row.status <> 'recorded' then
    return jsonb_build_object(
      'paymentId', payment_row.id,
      'contractId', contract_row.id,
      'paymentStatus', payment_row.status,
      'contractStatus', contract_row.status,
      'unlockedSessions', contract_row.unlocked_sessions,
      'replayed', true
    );
  end if;

  update public.bige_contract_payments
  set status = case when p_action = 'void' then 'voided' else 'refunded' end,
      voided_by = actor.id,
      voided_at = now(),
      void_reason = btrim(p_reason)
  where id = payment_row.id
  returning * into payment_row;

  select coalesce(sum(amount), 0)::bigint into total_paid
  from public.bige_contract_payments
  where contract_id = contract_row.id
    and status = 'recorded';

  previous_unlocked := contract_row.unlocked_sessions;
  next_unlocked := case
    when contract_row.total_amount <= 0 then 0
    else least(
      contract_row.total_sessions,
      floor(total_paid::numeric * contract_row.total_sessions / contract_row.total_amount)::integer
    )
  end;

  next_status := case
    when contract_row.used_sessions > next_unlocked then 'frozen'
    when contract_row.ends_at <= now() then 'expired'
    when next_unlocked > contract_row.used_sessions then 'active'
    else 'pending'
  end;

  update public.member_plan_contracts
  set unlocked_sessions = next_unlocked,
      remaining_sessions = greatest(next_unlocked - used_sessions, 0),
      payment_status = case
        when total_paid = 0 and p_action = 'refund' then 'refunded'
        when total_paid = 0 then 'unpaid'
        when total_paid >= total_amount then 'settled'
        else 'partially_paid'
      end,
      status = next_status,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

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
      'refund_reversal',
      next_unlocked - previous_unlocked,
      contract_row.remaining_sessions,
      'contract_payment',
      payment_row.id::text,
      btrim(p_reason),
      jsonb_build_object('action', p_action, 'totalPaid', total_paid),
      actor.id
    );
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    contract_row.tenant_id,
    actor.id,
    case when p_action = 'void' then 'fitness_contract_payment_voided' else 'fitness_contract_payment_refunded' end,
    'bige_contract_payment',
    payment_row.id::text,
    btrim(p_reason),
    jsonb_build_object(
      'contractId', contract_row.id,
      'amount', payment_row.amount,
      'totalPaid', total_paid,
      'unlockedSessions', next_unlocked,
      'contractStatus', next_status
    )
  );

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'contractId', contract_row.id,
    'paymentStatus', payment_row.status,
    'contractStatus', contract_row.status,
    'unlockedSessions', contract_row.unlocked_sessions,
    'totalPaid', total_paid,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_reverse_contract_payment(uuid, text, text) from public, anon;
grant execute on function public.bige_reverse_contract_payment(uuid, text, text) to authenticated;

commit;
