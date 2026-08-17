begin;

-- Production migration version: 20260817133052.

alter table public.member_plan_contracts
  add column if not exists course_allocations_configured_at timestamptz,
  add column if not exists course_allocations_configured_by uuid
    references public.profiles(id) on delete set null,
  add column if not exists course_allocation_legacy_snapshot jsonb;

comment on column public.member_plan_contracts.course_allocations_configured_at is
  'Null means the legacy course list has not been explicitly split into per-course quotas.';
comment on column public.member_plan_contracts.course_allocations_configured_by is
  'Manager or assistant manager who last configured the per-course quotas.';
comment on column public.member_plan_contracts.course_allocation_legacy_snapshot is
  'One-time recoverable copy of legacy course allocation and categorized-use values before initialization.';

-- Every existing member starts in the explicitly unconfigured state requested
-- by operations. Overall used_sessions is preserved; only the new categorized
-- counter starts from zero.
update public.member_plan_contracts
set course_allocation_legacy_snapshot = coalesce(
      course_allocation_legacy_snapshot,
      jsonb_build_object(
        'courseAllocations', coalesce(course_allocations, '{}'::jsonb),
        'courseUsed', coalesce(course_used, '{}'::jsonb)
      )
    ),
    course_used = '{}'::jsonb,
    course_allocations_configured_at = null,
    course_allocations_configured_by = null
where total_sessions is not null;

create or replace function public.bige_guard_contract_course_allocation_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (
       tg_op = 'UPDATE'
       or new.course_allocations_configured_at is not null
       or new.course_allocations_configured_by is not null
     ) then
    raise exception 'course_allocation_write_forbidden';
  end if;
  return new;
end;
$$;

revoke all on function public.bige_guard_contract_course_allocation_update()
  from public, anon, authenticated;

drop trigger if exists member_plan_contracts_course_allocation_guard
  on public.member_plan_contracts;
create trigger member_plan_contracts_course_allocation_guard
before update of
  course_allocations,
  course_used,
  course_allocations_configured_at,
  course_allocations_configured_by
on public.member_plan_contracts
for each row
execute function public.bige_guard_contract_course_allocation_update();

drop trigger if exists member_plan_contracts_course_allocation_insert_guard
  on public.member_plan_contracts;
create trigger member_plan_contracts_course_allocation_insert_guard
before insert
on public.member_plan_contracts
for each row
execute function public.bige_guard_contract_course_allocation_update();

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
    'fascia_knife'
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

-- Unconfigured legacy contracts continue deducting their overall balance but
-- do not start a specialty counter. Once explicitly configured, selection and
-- deduction use the manager-defined specialty quota.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bige_complete_schedule_booking_without_pin(uuid)'::regprocedure
  ) into function_definition;

  if function_definition not like '%course_allocations_configured boolean%' then
    function_definition := replace(
      function_definition,
      E'  status_window_exempt boolean := false;\nbegin',
      E'  status_window_exempt boolean := false;\n  course_allocations_configured boolean := false;\nbegin'
    );

    function_definition := replace(
      function_definition,
      E'      and c.unlocked_sessions > c.used_sessions\n      and coalesce((c.course_allocations->>booking_row.course_type)::integer, 0)\n          > coalesce((c.course_used->>booking_row.course_type)::integer, 0)',
      E'      and c.unlocked_sessions > c.used_sessions\n      and (\n        c.course_allocations_configured_at is null\n        or coalesce((c.course_allocations->>booking_row.course_type)::integer, 0)\n            > coalesce((c.course_used->>booking_row.course_type)::integer, 0)\n      )'
    );

    function_definition := replace(
      function_definition,
      E'  if allocation_used >= allocation_limit then\n    raise exception ''course_allocation_exhausted'';\n  end if;\n\n  next_course_used := jsonb_set(\n    coalesce(contract_row.course_used, ''{}''::jsonb),\n    array[booking_row.course_type],\n    to_jsonb(allocation_used + 1),\n    true\n  );',
      E'  course_allocations_configured :=\n    contract_row.course_allocations_configured_at is not null;\n\n  if course_allocations_configured and allocation_used >= allocation_limit then\n    raise exception ''course_allocation_exhausted'';\n  end if;\n\n  next_course_used := case\n    when course_allocations_configured then jsonb_set(\n      coalesce(contract_row.course_used, ''{}''::jsonb),\n      array[booking_row.course_type],\n      to_jsonb(allocation_used + 1),\n      true\n    )\n    else coalesce(contract_row.course_used, ''{}''::jsonb)\n  end;'
    );
  end if;

  if function_definition not like '%course_allocations_configured boolean%'
     or function_definition not like '%c.course_allocations_configured_at is null%'
     or function_definition not like '%when course_allocations_configured then jsonb_set%' then
    raise exception 'bige completion course allocation patch failed';
  end if;

  execute function_definition;

  select pg_get_functiondef(
    'public.bige_restore_completed_schedule_booking(uuid)'::regprocedure
  ) into function_definition;

  if function_definition not like '%contract_row.course_allocations_configured_at is null%' then
    function_definition := replace(
      function_definition,
      E'  next_course_used := jsonb_set(\n    coalesce(contract_row.course_used, ''{}''::jsonb),\n    array[booking_row.course_type],\n    to_jsonb(greatest(allocation_used - redemption_row.quantity, 0)),\n    true\n  );',
      E'  next_course_used := case\n    when contract_row.course_allocations_configured_at is null then\n      coalesce(contract_row.course_used, ''{}''::jsonb)\n    else jsonb_set(\n      coalesce(contract_row.course_used, ''{}''::jsonb),\n      array[booking_row.course_type],\n      to_jsonb(greatest(allocation_used - redemption_row.quantity, 0)),\n      true\n    )\n  end;'
    );
  end if;

  if function_definition not like '%contract_row.course_allocations_configured_at is null%' then
    raise exception 'bige completion restore course allocation patch failed';
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.bige_complete_schedule_booking_without_pin(uuid)
  from public, anon;
grant execute on function public.bige_complete_schedule_booking_without_pin(uuid)
  to authenticated;

revoke all on function public.bige_restore_completed_schedule_booking(uuid)
  from public, anon;
grant execute on function public.bige_restore_completed_schedule_booking(uuid)
  to authenticated;

commit;
