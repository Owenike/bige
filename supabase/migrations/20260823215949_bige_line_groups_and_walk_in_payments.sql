begin;

create table public.bige_line_group_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid references public.members(id) on delete restrict,
  line_group_id text not null,
  group_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'left', 'disabled')),
  joined_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  left_at timestamptz,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_line_group_bindings_group_id_not_blank
    check (length(btrim(line_group_id)) > 0),
  constraint bige_line_group_bindings_group_name_not_blank
    check (length(btrim(group_name)) > 0),
  constraint bige_line_group_bindings_active_member_required
    check (status <> 'active' or member_id is not null),
  unique (tenant_id, line_group_id)
);

create unique index bige_line_group_bindings_active_member_idx
  on public.bige_line_group_bindings(tenant_id, member_id)
  where status = 'active' and member_id is not null;

create index bige_line_group_bindings_tenant_status_seen_idx
  on public.bige_line_group_bindings(tenant_id, status, last_seen_at desc);

create index bige_line_group_bindings_member_idx
  on public.bige_line_group_bindings(tenant_id, member_id, status)
  where member_id is not null;

create table public.bige_line_schedule_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  binding_id uuid not null references public.bige_line_group_bindings(id) on delete restrict,
  event_kind text not null check (event_kind in ('created', 'updated', 'cancelled')),
  status text not null default 'pending'
    check (status in ('pending', 'retrying', 'sent', 'failed', 'cancelled')),
  message text not null,
  schedule_snapshot jsonb not null default '[]'::jsonb,
  dedupe_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  provider_response jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bige_line_schedule_notifications_dispatch_idx
  on public.bige_line_schedule_notifications(status, next_retry_at, created_at)
  where status in ('pending', 'retrying');

create index bige_line_schedule_notifications_member_idx
  on public.bige_line_schedule_notifications(tenant_id, member_id, created_at desc);

create table public.bige_walk_in_payment_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete restrict,
  contract_id uuid not null references public.member_plan_contracts(id) on delete restrict,
  payment_ids uuid[] not null default '{}'::uuid[],
  payment_type text not null check (payment_type in ('balance', 'renewal')),
  status text not null default 'recorded'
    check (status in ('recorded', 'voided', 'refunded')),
  total_amount bigint not null check (total_amount > 0),
  business_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  idempotency_key text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_employee_number text,
  actor_name text,
  line_binding_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_walk_in_payment_operations_idempotency_key_length
    check (length(btrim(idempotency_key)) >= 8),
  unique (tenant_id, idempotency_key)
);

create index bige_walk_in_payment_operations_day_idx
  on public.bige_walk_in_payment_operations(tenant_id, business_date, status, created_at desc);

create index bige_walk_in_payment_operations_member_idx
  on public.bige_walk_in_payment_operations(tenant_id, member_id, created_at desc);

create index bige_walk_in_payment_operations_contract_idx
  on public.bige_walk_in_payment_operations(tenant_id, contract_id, created_at desc);

alter table public.bige_line_group_bindings enable row level security;
alter table public.bige_line_schedule_notifications enable row level security;
alter table public.bige_walk_in_payment_operations enable row level security;

revoke all on table public.bige_line_group_bindings from public, anon, authenticated;
revoke all on table public.bige_line_schedule_notifications from public, anon, authenticated;
revoke all on table public.bige_walk_in_payment_operations from public, anon, authenticated;
grant all on table public.bige_line_group_bindings to service_role;
grant all on table public.bige_line_schedule_notifications to service_role;
grant all on table public.bige_walk_in_payment_operations to service_role;

comment on table public.bige_line_group_bindings is
  'Verified one-to-one mapping between a BIG E member and a LINE group. Group names are hints only; activation is explicit.';
comment on table public.bige_walk_in_payment_operations is
  'One row per walk-in payment submission. Split tenders remain one badge count.';

-- Employee 06 may now create contracts. The current v3-v7 wrappers all call
-- the established base function, so remove only its employee-number exclusion.
do $migration$
declare
  function_oid oid;
  function_definition text;
  old_guard text := '     or upper(actor.employee_number) = ''E000006'' then';
  new_guard text := '     then';
begin
  select procedure.oid into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'bige_create_member_contract';
  if function_oid is null then raise exception 'base_contract_function_not_found'; end if;
  function_definition := pg_get_functiondef(function_oid);
  if strpos(function_definition, old_guard) = 0 then
    raise exception 'employee_06_contract_guard_not_found:%', function_oid;
  end if;
  execute replace(function_definition, old_guard, new_guard);
end;
$migration$;

-- Team lead and above may collect payments. API capabilities still decide
-- which UI is exposed; the database remains tenant-scoped and actor-audited.
do $migration$
declare
  function_oid oid;
  function_definition text;
  old_positions text := 'actor.position in (''coach_assistant_manager'', ''coach_manager'', ''coach_city_manager'')';
  new_positions text := 'actor.position in (''coach_team_lead'', ''coach_director'', ''coach_assistant_manager'', ''coach_manager'', ''coach_city_manager'')';
begin
  select procedure.oid into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'bige_record_contract_payments_v1';
  if function_oid is null then raise exception 'split_payment_function_not_found'; end if;
  function_definition := pg_get_functiondef(function_oid);
  if strpos(function_definition, old_positions) = 0 then
    raise exception 'split_payment_position_guard_not_found';
  end if;
  execute replace(function_definition, old_positions, new_positions);
end;
$migration$;

create or replace function public.bige_create_member_contract_v7(
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
  p_walk_in boolean default false,
  p_walk_in_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  binding_row public.bige_line_group_bindings%rowtype;
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
  payment_ids uuid[];
  operation_id uuid;
  existing_operation public.bige_walk_in_payment_operations%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found then raise exception 'forbidden'; end if;

  if p_walk_in then
    if p_initial_payment <= 0 or length(btrim(coalesce(p_walk_in_idempotency_key, ''))) < 8 then
      raise exception 'walk_in_payment_invalid';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('bige-walk-in:' || p_tenant_id::text || ':' || btrim(p_walk_in_idempotency_key), 0)
    );
    select * into existing_operation
    from public.bige_walk_in_payment_operations operation
    where operation.tenant_id = p_tenant_id
      and operation.idempotency_key = btrim(p_walk_in_idempotency_key);
    if found then
      return jsonb_build_object(
        'contractId', existing_operation.contract_id,
        'memberId', existing_operation.member_id,
        'paymentIds', to_jsonb(existing_operation.payment_ids),
        'walkInOperationId', existing_operation.id,
        'replayed', true
      );
    end if;
  end if;

  select * into binding_row
  from public.bige_line_group_bindings binding
  where binding.id = p_line_binding_id
    and binding.tenant_id = p_tenant_id
    and binding.status in ('pending', 'active')
  for update;
  if not found then raise exception 'line_group_binding_required'; end if;
  if binding_row.member_id is not null
     and p_member_id is not null
     and binding_row.member_id is distinct from p_member_id then
    raise exception 'line_group_binding_member_mismatch';
  end if;

  contract_result := public.bige_create_member_contract_v6(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule,
    p_future_trial_action, p_fa_fee_recipient_profile_id,
    p_fa_fee_recipient_name, p_sales_origin_coach_id,
    p_sales_origin_kind, p_payment_source_booking_id
  );
  created_contract_id := (contract_result->>'contractId')::uuid;
  created_member_id := (contract_result->>'memberId')::uuid;

  if exists (
    select 1 from public.bige_line_group_bindings other_binding
    where other_binding.tenant_id = p_tenant_id
      and other_binding.member_id = created_member_id
      and other_binding.status = 'active'
      and other_binding.id <> binding_row.id
  ) then
    raise exception 'member_already_has_line_group';
  end if;

  update public.bige_line_group_bindings
  set member_id = created_member_id,
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      verified_by = coalesce(verified_by, actor.id),
      left_at = null,
      updated_at = now()
  where id = binding_row.id;

  if p_walk_in then
    select coalesce(array_agg(value::text::uuid), '{}'::uuid[]) into payment_ids
    from jsonb_array_elements_text(coalesce(contract_result->'paymentIds', '[]'::jsonb));

    insert into public.bige_walk_in_payment_operations (
      tenant_id, branch_id, member_id, contract_id, payment_ids,
      payment_type, total_amount, business_date, idempotency_key,
      actor_id, actor_employee_number, actor_name, line_binding_status,
      metadata
    ) values (
      p_tenant_id, p_branch_id, created_member_id, created_contract_id,
      payment_ids, 'renewal', p_initial_payment,
      (coalesce(p_signed_on, (now() at time zone 'Asia/Taipei')::date)),
      btrim(p_walk_in_idempotency_key), actor.id, actor.employee_number,
      coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'active', jsonb_build_object('source', 'daily_schedule_walk_in_button')
    )
    on conflict (tenant_id, idempotency_key) do update
      set updated_at = excluded.updated_at
    returning id into operation_id;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_contract_line_group_bound',
    'member_plan_contract', created_contract_id::text,
    case when p_walk_in then 'walk_in_renewal' else 'contract_creation' end,
    jsonb_build_object(
      'memberId', created_member_id,
      'lineBindingId', binding_row.id,
      'lineGroupName', binding_row.group_name,
      'walkInOperationId', operation_id,
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'before', jsonb_build_object('bindingStatus', binding_row.status, 'bindingMemberId', binding_row.member_id),
      'after', jsonb_build_object('bindingStatus', 'active', 'bindingMemberId', created_member_id)
    )
  );

  return contract_result || jsonb_build_object(
    'lineBindingId', binding_row.id,
    'walkInOperationId', operation_id
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v7(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v7(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text
) to authenticated;

create or replace function public.bige_create_bb_member_contract_v2(
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
  p_line_binding_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  binding_row public.bige_line_group_bindings%rowtype;
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found then raise exception 'forbidden'; end if;

  select * into binding_row
  from public.bige_line_group_bindings binding
  where binding.id = p_line_binding_id
    and binding.tenant_id = p_tenant_id
    and binding.status in ('pending', 'active')
  for update;
  if not found then raise exception 'line_group_binding_required'; end if;
  if binding_row.member_id is not null
     and p_member_id is not null
     and binding_row.member_id is distinct from p_member_id then
    raise exception 'line_group_binding_member_mismatch';
  end if;

  contract_result := public.bige_create_bb_member_contract_v1(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule
  );
  created_contract_id := (contract_result->>'contractId')::uuid;
  created_member_id := (contract_result->>'memberId')::uuid;

  if exists (
    select 1 from public.bige_line_group_bindings other_binding
    where other_binding.tenant_id = p_tenant_id
      and other_binding.member_id = created_member_id
      and other_binding.status = 'active'
      and other_binding.id <> binding_row.id
  ) then
    raise exception 'member_already_has_line_group';
  end if;

  update public.bige_line_group_bindings
  set member_id = created_member_id,
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      verified_by = coalesce(verified_by, actor.id),
      left_at = null,
      updated_at = now()
  where id = binding_row.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_contract_line_group_bound',
    'member_plan_contract', created_contract_id::text, 'bb_contract_creation',
    jsonb_build_object(
      'memberId', created_member_id,
      'lineBindingId', binding_row.id,
      'lineGroupName', binding_row.group_name,
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'before', jsonb_build_object('bindingStatus', binding_row.status, 'bindingMemberId', binding_row.member_id),
      'after', jsonb_build_object('bindingStatus', 'active', 'bindingMemberId', created_member_id)
    )
  );

  return contract_result || jsonb_build_object('lineBindingId', binding_row.id);
end;
$$;

revoke all on function public.bige_create_bb_member_contract_v2(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid
) from public, anon;
grant execute on function public.bige_create_bb_member_contract_v2(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid
) to authenticated;

create or replace function public.bige_record_walk_in_payments_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_contract_id uuid,
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
  binding_status text;
  payment_result jsonb;
  payment_ids uuid[];
  total_amount bigint;
  operation_id uuid;
  existing_operation public.bige_walk_in_payment_operations%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found
     or not (
       actor.role = 'platform_admin'
       or upper(coalesce(actor.employee_number, '')) = 'E000006'
       or (
         actor.department = 'coaching'
         and actor.position in ('coach_team_lead', 'coach_director', 'coach_assistant_manager', 'coach_manager', 'coach_city_manager')
       )
       or (
         actor.department is null and actor.position is null
         and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
       )
     ) then
    raise exception 'walk_in_payment_forbidden';
  end if;
  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'idempotency_key_required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('bige-walk-in:' || p_tenant_id::text || ':' || btrim(p_idempotency_key), 0)
  );
  select * into existing_operation
  from public.bige_walk_in_payment_operations operation
  where operation.tenant_id = p_tenant_id
    and operation.idempotency_key = btrim(p_idempotency_key);
  if found then
    if existing_operation.member_id is distinct from p_member_id
       or existing_operation.contract_id is distinct from p_contract_id then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'contractId', existing_operation.contract_id,
      'memberId', existing_operation.member_id,
      'paymentIds', to_jsonb(existing_operation.payment_ids),
      'totalAmount', existing_operation.total_amount,
      'walkInOperationId', existing_operation.id,
      'replayed', true
    );
  end if;

  select * into contract_row
  from public.member_plan_contracts contract
  where contract.id = p_contract_id
    and contract.tenant_id = p_tenant_id
    and contract.member_id = p_member_id
  for update;
  if not found then raise exception 'fitness_contract_not_found'; end if;

  payment_result := public.bige_record_contract_payments_v1(
    p_contract_id, null, null, p_payment_kind, p_payments,
    p_paid_at, p_idempotency_key, p_note
  );
  total_amount := coalesce((payment_result->>'totalAmount')::bigint, 0);
  if total_amount <= 0 then
    select coalesce(sum((entry->>'amount')::bigint), 0) into total_amount
    from jsonb_array_elements(p_payments) entry;
  end if;
  select coalesce(array_agg(value::text::uuid), '{}'::uuid[]) into payment_ids
  from jsonb_array_elements_text(coalesce(payment_result->'paymentIds', '[]'::jsonb));
  select binding.status into binding_status
  from public.bige_line_group_bindings binding
  where binding.tenant_id = p_tenant_id
    and binding.member_id = p_member_id
    and binding.status = 'active'
  limit 1;

  insert into public.bige_walk_in_payment_operations (
    tenant_id, branch_id, member_id, contract_id, payment_ids,
    payment_type, total_amount, business_date, idempotency_key,
    actor_id, actor_employee_number, actor_name, line_binding_status,
    metadata
  ) values (
    p_tenant_id, p_branch_id, p_member_id, p_contract_id, payment_ids,
    'balance', total_amount,
    ((coalesce(p_paid_at, now()) at time zone 'Asia/Taipei')::date),
    p_idempotency_key, actor.id, actor.employee_number,
    coalesce(actor.english_name, actor.display_name, actor.employee_number),
    coalesce(binding_status, 'unbound'),
    jsonb_build_object('source', 'daily_schedule_walk_in_button', 'paymentKind', p_payment_kind)
  )
  on conflict (tenant_id, idempotency_key) do update
    set updated_at = excluded.updated_at
  returning id into operation_id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_walk_in_payment_recorded',
    'bige_walk_in_payment_operation', operation_id::text,
    'daily_schedule_walk_in_button',
    jsonb_build_object(
      'memberId', p_member_id,
      'contractId', p_contract_id,
      'paymentIds', payment_ids,
      'paymentType', 'balance',
      'totalAmount', total_amount,
      'lineBindingStatus', coalesce(binding_status, 'unbound'),
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'before', jsonb_build_object('operationStatus', null),
      'after', jsonb_build_object('operationStatus', 'recorded')
    )
  );

  return payment_result || jsonb_build_object('walkInOperationId', operation_id);
end;
$$;

revoke all on function public.bige_record_walk_in_payments_v1(
  uuid, uuid, uuid, uuid, text, jsonb, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_walk_in_payments_v1(
  uuid, uuid, uuid, uuid, text, jsonb, timestamptz, text, text
) to authenticated;

commit;
