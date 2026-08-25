\set ON_ERROR_STOP on

do $$
begin
  if current_database() <> 'bige_explicit_fa_stage_test' then
    raise exception 'This regression test must run only in bige_explicit_fa_stage_test';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$$;

create table public.bookings (
  id uuid primary key,
  tenant_id uuid not null,
  operation_kind text not null,
  trial_stage text,
  operation_idempotency_key text not null unique,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  tenant_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb
);

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
set search_path = ''
as $$
declare
  booking_id uuid;
  stored_stage text;
begin
  select id, trial_stage
    into booking_id, stored_stage
  from public.bookings
  where tenant_id = p_tenant_id
    and operation_idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'bookingId', booking_id,
      'trialStage', stored_stage,
      'replayed', true
    );
  end if;

  booking_id := md5(p_idempotency_key)::uuid;
  stored_stage := case when p_operation_kind = 'trial' then 'FA1' else null end;
  insert into public.bookings (
    id, tenant_id, operation_kind, trial_stage, operation_idempotency_key
  ) values (
    booking_id, p_tenant_id, p_operation_kind, stored_stage, p_idempotency_key
  );
  insert into public.audit_logs (
    tenant_id, action, target_type, target_id, payload
  ) values (
    p_tenant_id,
    'bige_schedule_booking_created',
    'booking',
    booking_id::text,
    jsonb_build_object('trialStage', stored_stage)
  );

  return jsonb_build_object(
    'bookingId', booking_id,
    'trialStage', stored_stage,
    'replayed', false
  );
end;
$$;

\ir ../supabase/migrations/20260825170518_explicit_fa_stage_schedule.sql

do $$
declare
  tenant_id constant uuid := '00000000-0000-4000-8000-000000000001';
  result jsonb;
  stage text;
begin
  result := public.bige_create_schedule_booking_v3(
    tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
    '2026-09-06 13:00:00+08', '2026-09-06 15:00:00+08', null, null,
    'test:fa2', 'FA2'
  );
  if result ->> 'trialStage' <> 'FA2' then
    raise exception 'FA2 result was not preserved: %', result;
  end if;
  select trial_stage into stage from public.bookings where id = (result ->> 'bookingId')::uuid;
  if stage <> 'FA2' then raise exception 'FA2 booking was not persisted'; end if;
  select payload ->> 'trialStage' into stage
  from public.audit_logs where target_id = result ->> 'bookingId';
  if stage <> 'FA2' then raise exception 'FA2 audit payload was not updated'; end if;

  result := public.bige_create_schedule_booking_v3(
    tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
    '2026-09-07 13:00:00+08', '2026-09-07 15:00:00+08', null, null,
    'test:fan', 'FAN'
  );
  if result ->> 'trialStage' <> 'FAN' then
    raise exception 'FAN result was not preserved: %', result;
  end if;

  result := public.bige_create_schedule_booking_v3(
    tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
    '2026-09-08 13:00:00+08', '2026-09-08 15:00:00+08', null, null,
    'test:auto', null
  );
  if result ->> 'trialStage' <> 'FA1' then
    raise exception 'automatic FA stage changed unexpectedly: %', result;
  end if;

  result := public.bige_create_schedule_booking_v3(
    tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
    '2026-09-06 13:00:00+08', '2026-09-06 15:00:00+08', null, null,
    'test:fa2', 'FA2'
  );
  if not (result ->> 'replayed')::boolean then
    raise exception 'same-stage retry was not idempotent';
  end if;

  begin
    perform public.bige_create_schedule_booking_v3(
      tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
      '2026-09-06 13:00:00+08', '2026-09-06 15:00:00+08', null, null,
      'test:fa2', 'FAN'
    );
    raise exception 'different-stage retry should fail';
  exception when others then
    if sqlerrm <> 'idempotency_key_conflict' then raise; end if;
  end;

  begin
    perform public.bige_create_schedule_booking_v3(
      tenant_id, null, '00000000-0000-4000-8000-000000000023', null,
      '00000000-0000-4000-8000-000000000022', 'pt', 'weight_training',
      '2026-09-09 13:00:00+08', '2026-09-09 14:00:00+08', null, null,
      'test:pt-stage', 'FA2'
    );
    raise exception 'PT with explicit FA stage should fail';
  exception when others then
    if sqlerrm <> 'trial_stage_requires_trial_operation' then raise; end if;
  end;

  begin
    perform public.bige_create_schedule_booking_v3(
      tenant_id, null, null, '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000022', 'trial', 'weight_training',
      '2026-09-10 13:00:00+08', '2026-09-10 15:00:00+08', null, null,
      'test:fa1', 'FA1'
    );
    raise exception 'FA1 explicit override should fail';
  exception when others then
    if sqlerrm <> 'invalid_trial_stage' then raise; end if;
  end;
end;
$$;

select 'bige explicit FA stage regression passed' as result;
