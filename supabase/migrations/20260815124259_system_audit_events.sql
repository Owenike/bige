begin;

create table if not exists public.system_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  account_type text,
  account_identifier text,
  event_category text not null,
  action text not null,
  outcome text not null default 'success',
  target_type text,
  target_id text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  ip_address text,
  user_agent text,
  source_schema text,
  source_table text,
  source_record_id text,
  created_at timestamptz not null default now(),
  constraint system_audit_events_category_check
    check (event_category in ('authentication', 'data_change', 'data_access', 'security', 'system')),
  constraint system_audit_events_outcome_check
    check (outcome in ('success', 'failure', 'denied', 'rate_limited', 'info'))
);

create index if not exists system_audit_events_created_idx
  on public.system_audit_events(created_at desc);
create index if not exists system_audit_events_tenant_created_idx
  on public.system_audit_events(tenant_id, created_at desc);
create index if not exists system_audit_events_actor_created_idx
  on public.system_audit_events(actor_id, created_at desc);
create index if not exists system_audit_events_action_created_idx
  on public.system_audit_events(action, created_at desc);
create index if not exists system_audit_events_account_created_idx
  on public.system_audit_events(account_identifier, created_at desc)
  where account_identifier is not null;
create index if not exists system_audit_events_source_record_idx
  on public.system_audit_events(source_table, source_record_id, created_at desc)
  where source_table is not null and source_record_id is not null;

alter table public.system_audit_events enable row level security;
revoke all on table public.system_audit_events from public, anon, authenticated;
grant all on table public.system_audit_events to service_role;

create or replace function public.capture_system_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_context jsonb;
  v_before_changed jsonb;
  v_after_changed jsonb;
  v_changed_fields jsonb;
  v_actor_text text;
  v_tenant_text text;
  v_branch_text text;
  v_record_id text;
  v_actor_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if v_before = v_after then
      return new;
    end if;
  else
    v_before := to_jsonb(old);
  end if;

  v_context := coalesce(v_after, v_before, '{}'::jsonb);
  v_record_id := v_context ->> 'id';
  v_tenant_text := nullif(v_context ->> 'tenant_id', '');
  v_branch_text := nullif(v_context ->> 'branch_id', '');
  v_actor_text := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(v_context ->> 'updated_by', ''),
    nullif(v_context ->> 'reminder_updated_by', ''),
    nullif(v_context ->> 'created_by', ''),
    nullif(v_context ->> 'requested_by', ''),
    nullif(v_context ->> 'resolved_by', ''),
    nullif(v_context ->> 'confirmed_by', ''),
    nullif(v_context ->> 'reopened_by', ''),
    nullif(v_context ->> 'auth_user_id', '')
  );

  begin
    v_actor_id := v_actor_text::uuid;
  exception when invalid_text_representation then
    v_actor_id := null;
  end;
  begin
    v_tenant_id := v_tenant_text::uuid;
  exception when invalid_text_representation then
    v_tenant_id := null;
  end;
  begin
    v_branch_id := v_branch_text::uuid;
  exception when invalid_text_representation then
    v_branch_id := null;
  end;
  if v_actor_id is not null and not exists (
    select 1 from public.profiles where id = v_actor_id
  ) then
    v_actor_id := null;
  end if;

  if tg_op = 'UPDATE' then
    select
      coalesce(jsonb_object_agg(keys.key, v_before -> keys.key), '{}'::jsonb),
      coalesce(jsonb_object_agg(keys.key, v_after -> keys.key), '{}'::jsonb),
      coalesce(jsonb_agg(to_jsonb(keys.key) order by keys.key), '[]'::jsonb)
    into v_before_changed, v_after_changed, v_changed_fields
    from jsonb_object_keys(v_before || v_after) as keys(key)
    where v_before -> keys.key is distinct from v_after -> keys.key;
  else
    v_before_changed := v_before;
    v_after_changed := v_after;
    v_changed_fields := '[]'::jsonb;
  end if;

  insert into public.system_audit_events (
    tenant_id,
    branch_id,
    actor_id,
    event_category,
    action,
    outcome,
    target_type,
    target_id,
    before_state,
    after_state,
    metadata,
    source_schema,
    source_table,
    source_record_id
  ) values (
    v_tenant_id,
    v_branch_id,
    v_actor_id,
    'data_change',
    'data.' || tg_table_name || '.' || lower(tg_op),
    'success',
    tg_table_name,
    v_record_id,
    v_before_changed,
    v_after_changed,
    jsonb_build_object(
      'capture', 'database_trigger',
      'operation', lower(tg_op),
      'changedFields', v_changed_fields
    ),
    tg_table_schema,
    tg_table_name,
    v_record_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.capture_system_audit_row_change() from public, anon, authenticated;

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'bookings',
    'bige_schedule_notes',
    'bige_schedule_coach_order',
    'member_plan_catalog',
    'member_plan_contracts',
    'bige_contract_payments',
    'bige_daily_closures',
    'high_risk_action_requests',
    'member_device_sessions'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      v_trigger := 'system_audit_' || v_table;
      execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.capture_system_audit_row_change()',
        v_trigger,
        v_table
      );
    end if;
  end loop;
end;
$block$;

commit;
