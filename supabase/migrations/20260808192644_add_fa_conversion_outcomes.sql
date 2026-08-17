begin;

alter table public.bookings
  add column if not exists trial_conversion_outcome text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_trial_conversion_outcome_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_trial_conversion_outcome_check
      check (
        trial_conversion_outcome is null
        or trial_conversion_outcome in ('pending_conversion', 'converted', 'not_converted')
      );
  end if;
end;
$$;

update public.bookings
set trial_conversion_outcome = 'converted'
where operation_kind = 'trial'
  and converted_at is not null
  and trial_conversion_outcome is distinct from 'converted';

create or replace function public.bige_sync_trial_conversion_outcome()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operation_kind = 'trial' and new.converted_at is not null then
    new.trial_conversion_outcome := 'converted';
  end if;
  return new;
end;
$$;

drop trigger if exists bige_sync_trial_conversion_outcome_trigger on public.bookings;
create trigger bige_sync_trial_conversion_outcome_trigger
before insert or update of converted_at, operation_kind on public.bookings
for each row
execute function public.bige_sync_trial_conversion_outcome();

revoke all on function public.bige_sync_trial_conversion_outcome() from public, anon, authenticated;

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
    and (
      coalesce((p_allocations->>'weight_training')::integer, 0)
      + coalesce((p_allocations->>'relaxation')::integer, 0)
      + coalesce((p_allocations->>'reformer_pilates')::integer, 0)
      + coalesce((p_allocations->>'sports_cupping')::integer, 0)
      + coalesce((p_allocations->>'fascia_knife')::integer, 0)
    ) = p_total_sessions;
$$;

revoke all on function public.bige_validate_course_allocations(jsonb, integer) from public, anon;
grant execute on function public.bige_validate_course_allocations(jsonb, integer) to authenticated;

create or replace function public.bige_complete_trial_outcome(
  p_booking_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  can_manage boolean := false;
  window_exempt boolean := false;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found then
    raise exception 'forbidden';
  end if;

  can_manage :=
    actor.role = 'platform_admin'
    or upper(coalesce(actor.employee_number, '')) in ('E000001', 'E000006')
    or (
      actor.department = 'coaching'
      and actor.position in (
        'coach_team_lead',
        'coach_director',
        'coach_assistant_manager',
        'coach_manager',
        'coach_city_manager'
      )
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
    );

  if not can_manage then
    raise exception 'forbidden';
  end if;

  if p_outcome not in ('pending_conversion', 'not_converted') then
    raise exception 'invalid_trial_conversion_outcome';
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

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if booking_row.converted_at is not null then
    raise exception 'trial_already_converted';
  end if;

  if booking_row.status not in ('pending', 'confirmed', 'booked', 'checked_in', 'completed') then
    raise exception 'booking_not_active';
  end if;

  window_exempt :=
    actor.role in ('platform_admin', 'manager', 'branch_manager', 'store_owner', 'store_manager')
    or actor.position in (
      'general_affairs_assistant_manager',
      'general_affairs_manager',
      'coach_assistant_manager',
      'coach_manager',
      'coach_city_manager'
    );

  if not window_exempt
     and (
       now() < booking_row.starts_at - interval '30 minutes'
       or now() > booking_row.ends_at + interval '30 minutes'
     ) then
    raise exception 'outside_completion_window';
  end if;

  update public.bookings
  set status = 'completed',
      operation_result = 'completed',
      trial_conversion_outcome = p_outcome,
      completed_at = coalesce(completed_at, now()),
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id
  returning * into booking_row;

  if p_outcome = 'not_converted' then
    update public.crm_leads
    set status = 'lost',
        trial_status = 'attended',
        trial_result = 'lost',
        lost_reason = 'fa_not_converted',
        updated_by = actor.id,
        updated_at = now()
    where tenant_id = booking_row.tenant_id
      and trial_booking_id = booking_row.trial_booking_id;
  else
    update public.crm_leads
    set status = 'trial_completed',
        trial_status = 'attended',
        trial_result = null,
        lost_reason = null,
        updated_by = actor.id,
        updated_at = now()
    where tenant_id = booking_row.tenant_id
      and trial_booking_id = booking_row.trial_booking_id
      and status <> 'won';
  end if;

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
    actor.id,
    'bige_trial_outcome_recorded',
    'booking',
    booking_row.id::text,
    p_outcome,
    jsonb_build_object(
      'outcome', p_outcome,
      'trialBookingId', booking_row.trial_booking_id,
      'memberId', booking_row.member_id
    )
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', booking_row.status,
    'operationResult', booking_row.operation_result,
    'trialConversionOutcome', booking_row.trial_conversion_outcome
  );
end;
$$;

revoke all on function public.bige_complete_trial_outcome(uuid, text) from public, anon;
grant execute on function public.bige_complete_trial_outcome(uuid, text) to authenticated;

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
     or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
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

commit;
