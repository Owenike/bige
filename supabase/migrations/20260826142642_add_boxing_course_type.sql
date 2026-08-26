begin;

alter table public.bookings
  drop constraint if exists bookings_course_type_check;
alter table public.bookings
  add constraint bookings_course_type_check
  check (
    course_type is null
    or course_type in (
      'weight_training',
      'relaxation',
      'reformer_pilates',
      'sports_cupping',
      'fascia_knife',
      'boxing',
      'onsite_assessment'
    )
  );

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
    and coalesce((p_allocations->>'sports_cupping')::integer, 0) >= 0
    and coalesce((p_allocations->>'fascia_knife')::integer, 0) >= 0
    and coalesce((p_allocations->>'boxing')::integer, 0) >= 0
    and (
      coalesce((p_allocations->>'weight_training')::integer, 0)
      + coalesce((p_allocations->>'relaxation')::integer, 0)
      + coalesce((p_allocations->>'reformer_pilates')::integer, 0)
      + coalesce((p_allocations->>'sports_cupping')::integer, 0)
      + coalesce((p_allocations->>'fascia_knife')::integer, 0)
      + coalesce((p_allocations->>'boxing')::integer, 0)
    ) = p_total_sessions;
$$;

revoke all on function public.bige_validate_course_allocations(jsonb, integer)
  from public, anon;
grant execute on function public.bige_validate_course_allocations(jsonb, integer)
  to authenticated;

create or replace function public.bige_configure_contract_course_allocations(
  p_contract_id uuid,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  allowed_courses constant text[] := array[
    'weight_training',
    'relaxation',
    'reformer_pilates',
    'sports_cupping',
    'fascia_knife',
    'boxing'
  ];
  course_key text;
  allocation_numeric numeric;
  allocation_value integer;
  used_value integer;
  allocation_total integer := 0;
  first_configuration boolean;
  normalized_allocations jsonb := '{}'::jsonb;
  normalized_used jsonb := '{}'::jsonb;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found or not (
    actor.role = 'platform_admin'
    or (
      actor.department::text = 'coaching'
      and actor.position::text in (
        'coach_assistant_manager',
        'coach_manager',
        'coach_city_manager'
      )
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in (
        'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
      )
    )
  ) then
    raise exception 'manager_required';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = p_contract_id
  for update;

  if not found
     or contract_row.total_sessions is null
     or contract_row.status = 'canceled' then
    raise exception 'contract_course_allocation_not_available';
  end if;

  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from contract_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'object' then
    raise exception 'course_allocations_invalid';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_allocations) as supplied(course_key)
    where not (supplied.course_key = any(allowed_courses))
  ) then
    raise exception 'course_allocations_invalid';
  end if;

  first_configuration := contract_row.course_allocations_configured_at is null;

  foreach course_key in array allowed_courses loop
    if p_allocations ? course_key then
      if jsonb_typeof(p_allocations -> course_key) <> 'number' then
        raise exception 'course_allocations_invalid';
      end if;
      allocation_numeric := (p_allocations ->> course_key)::numeric;
    else
      allocation_numeric := 0;
    end if;

    if allocation_numeric < 0
       or allocation_numeric <> trunc(allocation_numeric)
       or allocation_numeric > 100000 then
      raise exception 'course_allocations_invalid';
    end if;

    allocation_value := allocation_numeric::integer;
    used_value := case
      when first_configuration then 0
      else coalesce((contract_row.course_used ->> course_key)::integer, 0)
    end;

    if allocation_value < used_value then
      raise exception 'course_allocation_below_used';
    end if;

    allocation_total := allocation_total + allocation_value;
    normalized_allocations := jsonb_set(
      normalized_allocations,
      array[course_key],
      to_jsonb(allocation_value),
      true
    );
    normalized_used := jsonb_set(
      normalized_used,
      array[course_key],
      to_jsonb(used_value),
      true
    );
  end loop;

  if allocation_total <> contract_row.total_sessions then
    raise exception 'course_allocation_total_mismatch';
  end if;

  update public.member_plan_contracts
  set course_allocations = normalized_allocations,
      course_used = normalized_used,
      course_allocations_configured_at = now(),
      course_allocations_configured_by = actor.id,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  ) values (
    contract_row.tenant_id,
    actor.id,
    'fitness_course_allocations_configured',
    'member_plan_contract',
    contract_row.id::text,
    case when first_configuration then 'initial_configuration' else 'allocation_updated' end,
    jsonb_build_object(
      'memberId', contract_row.member_id,
      'totalSessions', contract_row.total_sessions,
      'allocations', contract_row.course_allocations,
      'courseUsed', contract_row.course_used
    )
  );

  return jsonb_build_object(
    'contractId', contract_row.id,
    'memberId', contract_row.member_id,
    'totalSessions', contract_row.total_sessions,
    'allocations', contract_row.course_allocations,
    'courseUsed', contract_row.course_used,
    'configuredAt', contract_row.course_allocations_configured_at
  );
end;
$$;

revoke all on function public.bige_configure_contract_course_allocations(uuid, jsonb)
  from public, anon;
grant execute on function public.bige_configure_contract_course_allocations(uuid, jsonb)
  to authenticated;

create or replace function public.bige_create_schedule_booking_v2(
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
  result jsonb;
  booking_id uuid;
  stored_course_type text;
  service_label text;
begin
  if p_operation_kind = 'bb' then
    if p_member_id is not null or p_trial_booking_id is null or p_course_type is not null then
      raise exception 'invalid_bb_schedule_input';
    end if;
    result := public.bige_create_bb_schedule_booking_v1(
      p_tenant_id, p_branch_id, p_trial_booking_id, p_coach_id,
      p_starts_at, p_ends_at, p_note, p_idempotency_key
    );
    return public.bige_append_legacy_reference_warning(
      result, p_coach_id, p_starts_at, p_ends_at
    );
  end if;

  if p_operation_kind not in ('pt', 'trial') then raise exception 'invalid_operation_kind'; end if;
  if p_course_type not in (
    'weight_training', 'relaxation', 'reformer_pilates',
    'sports_cupping', 'fascia_knife', 'boxing', 'onsite_assessment'
  ) then raise exception 'invalid_course_type'; end if;

  if p_course_type in ('weight_training', 'relaxation', 'reformer_pilates') then
    result := public.bige_create_schedule_booking(
      p_tenant_id, p_branch_id, p_member_id, p_trial_booking_id, p_coach_id,
      p_operation_kind, p_course_type, p_starts_at, p_ends_at, p_note,
      p_group_id, p_idempotency_key
    );
  else
    result := public.bige_create_schedule_booking(
      p_tenant_id, p_branch_id, p_member_id, p_trial_booking_id, p_coach_id,
      p_operation_kind, 'weight_training', p_starts_at, p_ends_at, p_note,
      p_group_id, p_idempotency_key
    );
    booking_id := (result ->> 'bookingId')::uuid;
    select course_type into stored_course_type
    from public.bookings
    where id = booking_id and tenant_id = p_tenant_id
    for update;
    if not found then raise exception 'schedule_booking_not_found'; end if;
    if coalesce((result ->> 'replayed')::boolean, false)
       and stored_course_type <> p_course_type then
      raise exception 'idempotency_key_conflict';
    end if;

    service_label := case p_course_type
      when 'sports_cupping' then '運動拔罐'
      when 'fascia_knife' then '筋膜刀'
      when 'boxing' then '拳擊 Boxing'
      when 'onsite_assessment' then '現場評估'
    end;
    if not coalesce((result ->> 'replayed')::boolean, false) then
      update public.bookings
      set course_type = p_course_type, service_name = service_label, updated_at = now()
      where id = booking_id;
      update public.audit_logs
      set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{courseType}', to_jsonb(p_course_type), true)
      where tenant_id = p_tenant_id
        and action = 'bige_schedule_booking_created'
        and target_type = 'booking'
        and target_id = booking_id::text;
    end if;
  end if;

  return public.bige_append_legacy_reference_warning(
    result, p_coach_id, p_starts_at, p_ends_at
  );
end;
$$;

revoke all on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated, service_role;

create or replace function public.bige_reschedule_schedule_booking_v2(
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
  result jsonb;
  tenant_id_value uuid;
  service_label text;
begin
  if p_course_type not in (
    'weight_training',
    'relaxation',
    'reformer_pilates',
    'sports_cupping',
    'fascia_knife',
    'boxing',
    'onsite_assessment'
  ) then
    raise exception 'invalid_course_type';
  end if;

  if p_course_type in ('weight_training', 'relaxation', 'reformer_pilates') then
    result := public.bige_reschedule_schedule_booking(
      p_booking_id,
      p_branch_id,
      p_coach_id,
      p_course_type,
      p_starts_at,
      p_ends_at,
      p_note
    );
  else
    result := public.bige_reschedule_schedule_booking(
      p_booking_id,
      p_branch_id,
      p_coach_id,
      'weight_training',
      p_starts_at,
      p_ends_at,
      p_note
    );

    service_label := case p_course_type
      when 'sports_cupping' then '運動拔罐'
      when 'fascia_knife' then '筋膜刀'
      when 'boxing' then '拳擊 Boxing'
      when 'onsite_assessment' then '現場評估'
    end;

    update public.bookings
    set course_type = p_course_type,
        service_name = service_label,
        updated_at = now()
    where id = p_booking_id
    returning tenant_id into tenant_id_value;

    if not found then
      raise exception 'schedule_booking_not_found';
    end if;

    update public.audit_logs
    set payload = jsonb_set(
      coalesce(payload, '{}'::jsonb),
      '{courseType}',
      to_jsonb(p_course_type),
      true
    )
    where tenant_id = tenant_id_value
      and target_type = 'booking'
      and target_id = p_booking_id::text
      and action in ('bige_schedule_booking_rescheduled', 'bige_schedule_booking_updated');
  end if;

  return public.bige_append_legacy_reference_warning(
    result, p_coach_id, p_starts_at, p_ends_at
  );
end;
$$;

revoke all on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated, service_role;

do $$
declare
  constraint_definition text;
  create_definition text;
  reschedule_definition text;
  allocation_definition text;
begin
  select pg_get_constraintdef(oid)
  into constraint_definition
  from pg_constraint
  where conname = 'bookings_course_type_check'
    and conrelid = 'public.bookings'::regclass;

  select pg_get_functiondef(
    'public.bige_create_schedule_booking_v2(uuid,uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,uuid,text)'::regprocedure
  ) into create_definition;
  select pg_get_functiondef(
    'public.bige_reschedule_schedule_booking_v2(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure
  ) into reschedule_definition;
  select pg_get_functiondef(
    'public.bige_configure_contract_course_allocations(uuid,jsonb)'::regprocedure
  ) into allocation_definition;

  if position('boxing' in coalesce(constraint_definition, '')) = 0
     or position('boxing' in coalesce(create_definition, '')) = 0
     or position('拳擊 Boxing' in coalesce(create_definition, '')) = 0
     or position('boxing' in coalesce(reschedule_definition, '')) = 0
     or position('拳擊 Boxing' in coalesce(reschedule_definition, '')) = 0
     or position('boxing' in coalesce(allocation_definition, '')) = 0
     or not public.bige_validate_course_allocations('{"boxing": 12}'::jsonb, 12)
     or public.bige_validate_course_allocations('{"boxing": 11}'::jsonb, 12) then
    raise exception 'boxing_course_type_regression';
  end if;
end;
$$;

commit;
