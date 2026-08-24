begin;

alter table public.bige_line_group_bindings
  add column if not exists verification_code text;

create or replace function public.bige_line_group_verification_code_v1(
  p_line_group_id text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(substr(
    encode(extensions.digest(convert_to(btrim(p_line_group_id), 'UTF8'), 'sha256'), 'hex'),
    1,
    8
  ));
$$;

create or replace function public.bige_assign_line_group_verification_code_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.verification_code is null
     or btrim(new.verification_code) = ''
     or new.line_group_id is distinct from old.line_group_id then
    new.verification_code := public.bige_line_group_verification_code_v1(new.line_group_id);
  else
    new.verification_code := upper(btrim(new.verification_code));
  end if;
  return new;
end;
$$;

drop trigger if exists bige_line_group_verification_code_trigger
  on public.bige_line_group_bindings;
create trigger bige_line_group_verification_code_trigger
before insert or update of line_group_id, verification_code
on public.bige_line_group_bindings
for each row execute function public.bige_assign_line_group_verification_code_v1();

update public.bige_line_group_bindings binding
set verification_code = public.bige_line_group_verification_code_v1(binding.line_group_id)
where verification_code is null or btrim(verification_code) = '';

alter table public.bige_line_group_bindings
  alter column verification_code set not null;

alter table public.bige_line_group_bindings
  drop constraint if exists bige_line_group_bindings_verification_code_format;

alter table public.bige_line_group_bindings
  add constraint bige_line_group_bindings_verification_code_format
  check (verification_code ~ '^[A-F0-9]{8}$');

create unique index if not exists bige_line_group_bindings_verification_code_idx
  on public.bige_line_group_bindings(tenant_id, verification_code);

comment on column public.bige_line_group_bindings.verification_code is
  'Human-readable group discriminator. It is not an authentication secret; delivery still uses LINE group ID.';

revoke all on function public.bige_line_group_verification_code_v1(text)
  from public, anon, authenticated;
revoke all on function public.bige_assign_line_group_verification_code_v1()
  from public, anon, authenticated;
grant execute on function public.bige_line_group_verification_code_v1(text)
  to service_role;

create or replace function public.bige_create_member_contract_v8(
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
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
  payment_ids uuid[];
  operation_id uuid;
  existing_operation public.bige_walk_in_payment_operations%rowtype;
begin
  if p_line_binding_id is not null then
    return public.bige_create_member_contract_v7(
      p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
      p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
      p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
      p_initial_payment, p_payments, p_payment_schedule,
      p_future_trial_action, p_fa_fee_recipient_profile_id,
      p_fa_fee_recipient_name, p_sales_origin_coach_id,
      p_sales_origin_kind, p_payment_source_booking_id,
      p_line_binding_id, p_walk_in, p_walk_in_idempotency_key
    );
  end if;

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
        'lineBindingId', null,
        'walkInOperationId', existing_operation.id,
        'replayed', true
      );
    end if;
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
      coalesce(p_signed_on, (now() at time zone 'Asia/Taipei')::date),
      btrim(p_walk_in_idempotency_key), actor.id, actor.employee_number,
      coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'unbound_test_mode', jsonb_build_object(
        'source', 'daily_schedule_walk_in_button',
        'lineBindingDeferred', true
      )
    )
    on conflict (tenant_id, idempotency_key) do update
      set updated_at = excluded.updated_at
    returning id into operation_id;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_contract_created_without_line_group',
    'member_plan_contract', created_contract_id::text, 'line_binding_test_mode',
    jsonb_build_object(
      'memberId', created_member_id,
      'lineBindingId', null,
      'lineBindingDeferred', true,
      'walkInOperationId', operation_id,
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number)
    )
  );

  return contract_result || jsonb_build_object(
    'lineBindingId', null,
    'lineBindingDeferred', true,
    'walkInOperationId', operation_id
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v8(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v8(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text
) to authenticated;

create or replace function public.bige_create_bb_member_contract_v3(
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
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
begin
  if p_line_binding_id is not null then
    return public.bige_create_bb_member_contract_v2(
      p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
      p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
      p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
      p_initial_payment, p_payments, p_payment_schedule, p_line_binding_id
    );
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found then raise exception 'forbidden'; end if;

  contract_result := public.bige_create_bb_member_contract_v1(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule
  );
  created_contract_id := (contract_result->>'contractId')::uuid;
  created_member_id := (contract_result->>'memberId')::uuid;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_contract_created_without_line_group',
    'member_plan_contract', created_contract_id::text, 'line_binding_test_mode',
    jsonb_build_object(
      'memberId', created_member_id,
      'lineBindingId', null,
      'lineBindingDeferred', true,
      'sourceBookingId', p_source_booking_id,
      'sourceOperationKind', 'bb',
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number)
    )
  );

  return contract_result || jsonb_build_object(
    'lineBindingId', null,
    'lineBindingDeferred', true
  );
end;
$$;

revoke all on function public.bige_create_bb_member_contract_v3(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid
) from public, anon;
grant execute on function public.bige_create_bb_member_contract_v3(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid
) to authenticated;

comment on function public.bige_create_member_contract_v8(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, text, uuid, text, uuid, text,
  uuid, uuid, boolean, text
) is 'Temporary test-mode contract entry point. LINE binding remains optional but is audited when deferred.';

comment on function public.bige_create_bb_member_contract_v3(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid,
  jsonb, date, text, bigint, jsonb, jsonb, uuid
) is 'Temporary test-mode BB contract entry point. LINE binding remains optional but is audited when deferred.';

commit;
