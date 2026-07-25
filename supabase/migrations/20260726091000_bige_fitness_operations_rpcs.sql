-- Transactional operations for BIG E fitness scheduling, contract activation,
-- payment-based session unlocking and student-confirmed session redemption.

begin;

create or replace function public.bige_validate_course_allocations(
  p_allocations jsonb,
  p_total_sessions integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    jsonb_typeof(coalesce(p_allocations, '{}'::jsonb)) = 'object'
    and coalesce((p_allocations->>'weight_training')::integer, 0) >= 0
    and coalesce((p_allocations->>'relaxation')::integer, 0) >= 0
    and coalesce((p_allocations->>'reformer_pilates')::integer, 0) >= 0
    and (
      coalesce((p_allocations->>'weight_training')::integer, 0)
      + coalesce((p_allocations->>'relaxation')::integer, 0)
      + coalesce((p_allocations->>'reformer_pilates')::integer, 0)
    ) = p_total_sessions;
$$;

revoke all on function public.bige_validate_course_allocations(jsonb, integer) from public, anon;
grant execute on function public.bige_validate_course_allocations(jsonb, integer) to authenticated;

create or replace function public.bige_set_attendance_pin(
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  target public.members%rowtype;
begin
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'attendance_pin_must_be_six_digits';
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found then
    raise exception 'unauthorized';
  end if;

  select * into target
  from public.members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from target.tenant_id then
    raise exception 'forbidden';
  end if;

  if target.attendance_pin_hash is not null
     and actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager') then
    raise exception 'manager_required_for_pin_reset';
  end if;

  if target.attendance_pin_hash is null
     and actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk', 'coach') then
    raise exception 'forbidden';
  end if;

  update public.members
  set attendance_pin_hash = crypt(p_pin, gen_salt('bf', 10)),
      attendance_pin_set_at = now(),
      attendance_pin_reset_required = false,
      updated_at = now()
  where id = p_member_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    target.tenant_id,
    actor.id,
    case when target.attendance_pin_hash is null then 'attendance_pin_created' else 'attendance_pin_reset' end,
    'member',
    target.id::text,
    null,
    jsonb_build_object('memberCode', target.member_code)
  );

  return jsonb_build_object('memberId', target.id, 'pinSet', true);
end;
$$;

revoke all on function public.bige_set_attendance_pin(uuid, text) from public, anon;
grant execute on function public.bige_set_attendance_pin(uuid, text) to authenticated;

create or replace function public.bige_create_schedule_booking(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_trial_booking_id uuid,
  p_coach_id uuid,
  p_operation_kind text,
  p_course_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_group_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  member_row public.members%rowtype;
  trial_row public.trial_bookings%rowtype;
  existing_booking public.bookings%rowtype;
  created_booking public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  local_day date;
  overlap_count integer;
  completed_trials integer;
  computed_stage text;
  normalized_phone text;
  group_course text;
  existing_group_id uuid;
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

  if p_operation_kind not in ('pt', 'trial') then
    raise exception 'invalid_operation_kind';
  end if;

  if p_course_type not in ('weight_training', 'relaxation', 'reformer_pilates') then
    raise exception 'invalid_course_type';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  local_start := p_starts_at at time zone 'Asia/Taipei';
  local_end := p_ends_at at time zone 'Asia/Taipei';
  local_day := local_start::date;

  if local_start::time < time '09:00'
     or local_end > (local_day + 1)::timestamp
     or extract(minute from local_start)::integer not in (0, 30)
     or extract(second from local_start)::integer <> 0
     or extract(minute from local_end)::integer not in (0, 30)
     or extract(second from local_end)::integer <> 0 then
    raise exception 'outside_business_hours';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;

  select * into existing_booking
  from public.bookings
  where tenant_id = p_tenant_id
    and operation_idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'bookingId', existing_booking.id,
      'memberId', existing_booking.member_id,
      'trialStage', existing_booking.trial_stage,
      'replayed', true
    );
  end if;

  if p_operation_kind = 'trial' and p_member_id is null then
    if p_trial_booking_id is null then
      raise exception 'trial_source_required';
    end if;

    select * into trial_row
    from public.trial_bookings
    where id = p_trial_booking_id
    for update;

    if not found then
      raise exception 'trial_booking_not_found';
    end if;

    if trial_row.member_id is not null then
      p_member_id := trial_row.member_id;
    else
      normalized_phone := regexp_replace(coalesce(trial_row.phone, ''), '[^0-9]', '', 'g');

      select * into member_row
      from public.members
      where tenant_id = p_tenant_id
        and phone_normalized = normalized_phone
      order by created_at
      limit 1
      for update;

      if not found then
        insert into public.members (
          tenant_id,
          store_id,
          full_name,
          phone,
          phone_normalized,
          birth_date,
          lead_source,
          status,
          portal_status,
          is_prospect,
          email_unavailable
        ) values (
          p_tenant_id,
          p_branch_id,
          trial_row.name,
          trial_row.phone,
          normalized_phone,
          trial_row.birthday,
          coalesce(trial_row.source, 'trial_booking'),
          'active',
          'pending_activation',
          true,
          true
        )
        returning * into member_row;
      end if;

      p_member_id := member_row.id;

      update public.trial_bookings
      set member_id = p_member_id,
          updated_at = now()
      where id = p_trial_booking_id;
    end if;
  end if;

  select * into member_row
  from public.members
  where id = p_member_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_coach_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_member_id::text, 0));
  if p_course_type in ('relaxation', 'reformer_pilates') then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':shared_equipment', 0));
  end if;

  select min(course_type), min(group_id::text)::uuid
    into group_course, existing_group_id
    from public.bookings
    where tenant_id = p_tenant_id
      and coach_id = p_coach_id
      and is_bige_schedule = true
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if group_course is not null and group_course <> p_course_type then
    raise exception 'group_course_type_mismatch';
  end if;

  if p_group_id is not null and exists (
    select 1
    from public.bookings
    where tenant_id = p_tenant_id
      and group_id = p_group_id
      and is_bige_schedule = true
      and course_type <> p_course_type
  ) then
    raise exception 'group_course_type_mismatch';
  end if;

  select count(*) into overlap_count
  from public.bookings
  where tenant_id = p_tenant_id
    and coach_id = p_coach_id
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if overlap_count >= 3 then
    raise exception 'coach_capacity_exceeded';
  end if;

  if exists (
    select 1
    from public.bookings
    where tenant_id = p_tenant_id
      and member_id = p_member_id
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'member_time_conflict';
  end if;

  if p_course_type in ('relaxation', 'reformer_pilates') then
    select count(*) into overlap_count
    from public.bookings
    where tenant_id = p_tenant_id
      and is_bige_schedule = true
      and course_type in ('relaxation', 'reformer_pilates')
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

    if overlap_count >= 2 then
      raise exception 'shared_equipment_capacity_exceeded';
    end if;
  end if;

  computed_stage := null;
  if p_operation_kind = 'trial' then
    select count(*) into completed_trials
    from public.bookings
    where member_id = p_member_id
      and is_bige_schedule = true
      and operation_kind = 'trial'
      and operation_result = 'completed';

    computed_stage := case
      when completed_trials = 0 then 'FA1'
      when completed_trials = 1 then 'FA2'
      else 'FAN'
    end;
  end if;

  insert into public.bookings (
    tenant_id,
    branch_id,
    member_id,
    coach_id,
    service_name,
    starts_at,
    ends_at,
    status,
    note,
    customer_name,
    customer_phone,
    source,
    payment_status,
    booking_payment_mode,
    created_by,
    is_bige_schedule,
    operation_kind,
    course_type,
    trial_stage,
    trial_booking_id,
    group_id,
    operation_idempotency_key,
    coach_conflict_scope,
    occupied_starts_at,
    occupied_ends_at
  ) values (
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_coach_id,
    case p_course_type
      when 'weight_training' then '重訓'
      when 'relaxation' then '放鬆'
      else '器械皮拉提斯'
    end,
    p_starts_at,
    p_ends_at,
    'booked',
    nullif(btrim(coalesce(p_note, '')), ''),
    member_row.full_name,
    member_row.phone,
    'staff',
    'unpaid',
    'package',
    actor.id,
    true,
    p_operation_kind,
    p_course_type,
    computed_stage,
    p_trial_booking_id,
    coalesce(p_group_id, existing_group_id, gen_random_uuid()),
    p_idempotency_key,
    null,
    null,
    null
  )
  returning * into created_booking;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id,
    actor.id,
    'bige_schedule_booking_created',
    'booking',
    created_booking.id::text,
    null,
    jsonb_build_object(
      'operationKind', p_operation_kind,
      'courseType', p_course_type,
      'trialStage', computed_stage,
      'coachId', p_coach_id,
      'memberId', p_member_id,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at
    )
  );

  return jsonb_build_object(
    'bookingId', created_booking.id,
    'memberId', created_booking.member_id,
    'trialStage', created_booking.trial_stage,
    'groupId', created_booking.group_id,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated;

create or replace function public.bige_reschedule_schedule_booking(
  p_booking_id uuid,
  p_branch_id uuid,
  p_coach_id uuid,
  p_course_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  local_day date;
  overlap_count integer;
  group_course text;
  existing_group_id uuid;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;

  select * into target
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from target.tenant_id then
    raise exception 'forbidden';
  end if;

  if target.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
    raise exception 'booking_not_reschedulable';
  end if;

  if p_course_type not in ('weight_training', 'relaxation', 'reformer_pilates') then
    raise exception 'invalid_course_type';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  local_start := p_starts_at at time zone 'Asia/Taipei';
  local_end := p_ends_at at time zone 'Asia/Taipei';
  local_day := local_start::date;

  if local_start::time < time '09:00'
     or local_end > (local_day + 1)::timestamp
     or extract(minute from local_start)::integer not in (0, 30)
     or extract(second from local_start)::integer <> 0
     or extract(minute from local_end)::integer not in (0, 30)
     or extract(second from local_end)::integer <> 0 then
    raise exception 'outside_business_hours';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':' || p_coach_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':' || target.member_id::text, 0));
  if p_course_type in ('relaxation', 'reformer_pilates') then
    perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':shared_equipment', 0));
  end if;

  select min(course_type), min(group_id::text)::uuid
    into group_course, existing_group_id
    from public.bookings
    where tenant_id = target.tenant_id
      and id <> target.id
      and coach_id = p_coach_id
      and is_bige_schedule = true
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if group_course is not null and group_course <> p_course_type then
    raise exception 'group_course_type_mismatch';
  end if;

  select count(*) into overlap_count
  from public.bookings
  where tenant_id = target.tenant_id
    and id <> target.id
    and coach_id = p_coach_id
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if overlap_count >= 3 then
    raise exception 'coach_capacity_exceeded';
  end if;

  if exists (
    select 1
    from public.bookings
    where tenant_id = target.tenant_id
      and id <> target.id
      and member_id = target.member_id
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'member_time_conflict';
  end if;

  if p_course_type in ('relaxation', 'reformer_pilates') then
    select count(*) into overlap_count
    from public.bookings
    where tenant_id = target.tenant_id
      and id <> target.id
      and is_bige_schedule = true
      and course_type in ('relaxation', 'reformer_pilates')
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

    if overlap_count >= 2 then
      raise exception 'shared_equipment_capacity_exceeded';
    end if;
  end if;

  update public.bookings
  set branch_id = coalesce(p_branch_id, branch_id),
      coach_id = p_coach_id,
      service_name = case p_course_type
        when 'weight_training' then '重訓'
        when 'relaxation' then '放鬆'
        else '器械皮拉提斯'
      end,
      course_type = p_course_type,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      group_id = coalesce(existing_group_id, gen_random_uuid()),
      updated_at = now()
  where id = target.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    target.tenant_id,
    actor.id,
    'bige_schedule_booking_rescheduled',
    'booking',
    target.id::text,
    null,
    jsonb_build_object(
      'previousCoachId', target.coach_id,
      'coachId', p_coach_id,
      'previousStartsAt', target.starts_at,
      'startsAt', p_starts_at,
      'previousEndsAt', target.ends_at,
      'endsAt', p_ends_at,
      'previousCourseType', target.course_type,
      'courseType', p_course_type
    )
  );

  return jsonb_build_object(
    'bookingId', target.id,
    'memberId', target.member_id,
    'trialStage', target.trial_stage,
    'groupId', coalesce(existing_group_id, target.group_id),
    'rescheduled', true
  );
end;
$$;

revoke all on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated;

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

  if p_full_name is null or btrim(p_full_name) = '' or p_phone is null or btrim(p_phone) = '' or p_birth_date is null then
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
      birth_date = p_birth_date,
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

create or replace function public.bige_record_contract_payment(
  p_contract_id uuid,
  p_schedule_item_id uuid,
  p_payment_kind text,
  p_amount bigint,
  p_method text,
  p_paid_at timestamptz,
  p_idempotency_key text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  existing_payment public.bige_contract_payments%rowtype;
  prior_paid bigint;
  total_paid bigint;
  previous_unlocked integer;
  next_unlocked integer;
  unlock_delta integer;
  minimum_deposit bigint;
  next_payment_status text;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;

  if p_amount <= 0 then
    raise exception 'payment_amount_invalid';
  end if;

  if p_payment_kind not in ('deposit', 'balance', 'installment') then
    raise exception 'payment_kind_invalid';
  end if;

  if p_method not in ('cash', 'bank_transfer', 'card_terminal', 'acpay', 'other') then
    raise exception 'payment_method_invalid';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;

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

  select * into existing_payment
  from public.bige_contract_payments
  where tenant_id = contract_row.tenant_id
    and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'paymentId', existing_payment.id,
      'contractId', contract_row.id,
      'unlockedSessions', contract_row.unlocked_sessions,
      'remainingSessions', contract_row.remaining_sessions,
      'replayed', true
    );
  end if;

  select coalesce(sum(amount), 0)::bigint into prior_paid
  from public.bige_contract_payments
  where contract_id = contract_row.id and status = 'recorded';

  if prior_paid = 0 then
    minimum_deposit := ceil(contract_row.total_amount::numeric / contract_row.total_sessions)::bigint;
    if p_amount < minimum_deposit then
      raise exception 'minimum_deposit_not_met';
    end if;
  end if;

  insert into public.bige_contract_payments (
    tenant_id,
    contract_id,
    schedule_item_id,
    payment_kind,
    amount,
    method,
    status,
    paid_at,
    idempotency_key,
    note,
    recorded_by
  ) values (
    contract_row.tenant_id,
    contract_row.id,
    p_schedule_item_id,
    p_payment_kind,
    p_amount,
    p_method,
    'recorded',
    coalesce(p_paid_at, now()),
    p_idempotency_key,
    nullif(btrim(coalesce(p_note, '')), ''),
    actor.id
  )
  returning * into existing_payment;

  total_paid := prior_paid + p_amount;
  previous_unlocked := contract_row.unlocked_sessions;
  next_unlocked := least(
    contract_row.total_sessions,
    floor(total_paid::numeric * contract_row.total_sessions / contract_row.total_amount)::integer
  );
  unlock_delta := greatest(next_unlocked - previous_unlocked, 0);
  next_payment_status := case
    when total_paid >= contract_row.total_amount then 'settled'
    when prior_paid = 0 and p_payment_kind = 'deposit' then 'deposit_paid'
    else 'partially_paid'
  end;

  update public.member_plan_contracts
  set unlocked_sessions = next_unlocked,
      remaining_sessions = greatest(next_unlocked - used_sessions, 0),
      payment_status = next_payment_status,
      status = case
        when ends_at is not null and ends_at <= now() then 'expired'
        when next_unlocked > used_sessions then 'active'
        else 'pending'
      end,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

  if unlock_delta > 0 then
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
      'grant',
      unlock_delta,
      contract_row.remaining_sessions,
      'contract_payment',
      existing_payment.id::text,
      'payment_unlock',
      jsonb_build_object('amount', p_amount, 'totalPaid', total_paid),
      actor.id
    );
  end if;

  if p_schedule_item_id is not null then
    update public.bige_contract_payment_schedule
    set paid_amount = least(due_amount, paid_amount + p_amount),
        status = case
          when paid_amount + p_amount >= due_amount then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where id = p_schedule_item_id
      and contract_id = contract_row.id;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    contract_row.tenant_id,
    actor.id,
    'fitness_contract_payment_recorded',
    'bige_contract_payment',
    existing_payment.id::text,
    null,
    jsonb_build_object(
      'contractId', contract_row.id,
      'amount', p_amount,
      'method', p_method,
      'unlockedSessions', contract_row.unlocked_sessions,
      'paymentStatus', contract_row.payment_status
    )
  );

  return jsonb_build_object(
    'paymentId', existing_payment.id,
    'contractId', contract_row.id,
    'totalPaid', total_paid,
    'unlockedSessions', contract_row.unlocked_sessions,
    'remainingSessions', contract_row.remaining_sessions,
    'paymentStatus', contract_row.payment_status,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) to authenticated;

create or replace function public.bige_complete_schedule_booking(
  p_booking_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  member_row public.members%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  redemption_row public.session_redemptions%rowtype;
  allocation_limit integer;
  allocation_used integer;
  next_course_used jsonb;
  local_business_date date;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk', 'coach') then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if actor.role = 'coach' and booking_row.coach_id is distinct from actor.id then
    raise exception 'coach_booking_scope_denied';
  end if;

  if booking_row.operation_kind <> 'pt' then
    raise exception 'pt_booking_required';
  end if;

  if booking_row.status = 'completed' then
    select * into redemption_row
    from public.session_redemptions
    where booking_id = booking_row.id
    limit 1;

    return jsonb_build_object(
      'bookingId', booking_row.id,
      'contractId', redemption_row.member_plan_contract_id,
      'completed', true,
      'replayed', true
    );
  end if;

  if booking_row.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
    raise exception 'booking_not_active';
  end if;

  if now() < booking_row.starts_at - interval '30 minutes'
     or now() > booking_row.ends_at + interval '30 minutes' then
    raise exception 'outside_completion_window';
  end if;

  select * into member_row
  from public.members
  where id = booking_row.member_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  if member_row.attendance_pin_hash is null or member_row.attendance_pin_reset_required then
    raise exception 'attendance_pin_setup_required';
  end if;

  if crypt(p_pin, member_row.attendance_pin_hash) <> member_row.attendance_pin_hash then
    raise exception 'attendance_pin_invalid';
  end if;

  if booking_row.member_plan_contract_id is not null then
    select * into contract_row
    from public.member_plan_contracts
    where id = booking_row.member_plan_contract_id
      and member_id = booking_row.member_id
    for update;
  else
    select * into contract_row
    from public.member_plan_contracts c
    where c.member_id = booking_row.member_id
      and c.tenant_id = booking_row.tenant_id
      and c.status in ('active', 'expired')
      and c.unlocked_sessions > c.used_sessions
      and coalesce((c.course_allocations->>booking_row.course_type)::integer, 0)
          > coalesce((c.course_used->>booking_row.course_type)::integer, 0)
    order by c.ends_at asc nulls last, c.created_at
    limit 1
    for update;
  end if;

  if not found then
    raise exception 'eligible_contract_not_found';
  end if;

  if contract_row.ends_at is null or contract_row.ends_at <= now() then
    raise exception 'contract_extension_required';
  end if;

  if contract_row.status <> 'active'
     or contract_row.unlocked_sessions <= contract_row.used_sessions
     or coalesce(contract_row.remaining_sessions, 0) <= 0 then
    raise exception 'unlocked_sessions_exhausted';
  end if;

  allocation_limit := coalesce((contract_row.course_allocations->>booking_row.course_type)::integer, 0);
  allocation_used := coalesce((contract_row.course_used->>booking_row.course_type)::integer, 0);
  if allocation_used >= allocation_limit then
    raise exception 'course_allocation_exhausted';
  end if;

  next_course_used := jsonb_set(
    contract_row.course_used,
    array[booking_row.course_type],
    to_jsonb(allocation_used + 1),
    true
  );

  update public.member_plan_contracts
  set used_sessions = used_sessions + 1,
      remaining_sessions = greatest(unlocked_sessions - (used_sessions + 1), 0),
      course_used = next_course_used,
      status = case
        when used_sessions + 1 >= total_sessions then 'exhausted'
        when unlocked_sessions <= used_sessions + 1 then 'pending'
        else 'active'
      end,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

  insert into public.session_redemptions (
    tenant_id,
    booking_id,
    member_id,
    member_plan_contract_id,
    redeemed_by,
    redeemed_kind,
    quantity,
    note,
    session_no
  ) values (
    booking_row.tenant_id,
    booking_row.id,
    booking_row.member_id,
    contract_row.id,
    actor.id,
    'pass',
    1,
    'BIG E student-confirmed session',
    contract_row.used_sessions
  )
  returning * into redemption_row;

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
    'redeem',
    -1,
    contract_row.remaining_sessions,
    'booking',
    booking_row.id::text,
    'student_pin_confirmed',
    jsonb_build_object('courseType', booking_row.course_type, 'coachId', booking_row.coach_id),
    actor.id
  );

  update public.bookings
  set status = 'completed',
      operation_result = 'completed',
      completed_at = now(),
      status_updated_at = now(),
      member_plan_contract_id = contract_row.id,
      package_sessions_reserved = 0,
      package_sessions_consumed = greatest(package_sessions_consumed, 1),
      updated_at = now()
  where id = booking_row.id;

  local_business_date := (booking_row.starts_at at time zone 'Asia/Taipei')::date;
  update public.bige_daily_closures
  set status = 'reopened',
      revision = revision + 1,
      reopened_by = actor.id,
      reopened_at = now(),
      reopen_reason = 'booking_completed_after_confirmation',
      confirmed_by = null,
      confirmed_at = null,
      updated_at = now()
  where tenant_id = booking_row.tenant_id
    and business_date = local_business_date
    and status = 'confirmed'
    and (branch_id is not distinct from booking_row.branch_id);

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id,
    actor.id,
    'fitness_session_completed',
    'booking',
    booking_row.id::text,
    'student_pin_confirmed',
    jsonb_build_object(
      'contractId', contract_row.id,
      'memberId', booking_row.member_id,
      'courseType', booking_row.course_type,
      'redemptionId', redemption_row.id
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'contractId', contract_row.id,
    'redemptionId', redemption_row.id,
    'memberId', member_row.id,
    'memberName', member_row.full_name,
    'memberEmail', member_row.email,
    'emailUnavailable', member_row.email_unavailable,
    'courseType', booking_row.course_type,
    'startsAt', booking_row.starts_at,
    'coachId', booking_row.coach_id,
    'completed', true,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_complete_schedule_booking(uuid, text) from public, anon;
grant execute on function public.bige_complete_schedule_booking(uuid, text) to authenticated;

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

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager') then
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

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager') then
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
