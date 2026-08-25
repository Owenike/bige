create or replace function public.bige_create_schedule_booking_v3(
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
  p_idempotency_key text,
  p_trial_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  booking_id uuid;
  stored_operation_kind text;
  stored_trial_stage text;
  replayed boolean;
begin
  if p_trial_stage is not null then
    if p_operation_kind <> 'trial' then
      raise exception 'trial_stage_requires_trial_operation';
    end if;
    if p_trial_stage not in ('FA2', 'FAN') then
      raise exception 'invalid_trial_stage';
    end if;
  end if;

  result := public.bige_create_schedule_booking_v2(
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_trial_booking_id,
    p_coach_id,
    p_operation_kind,
    p_course_type,
    p_starts_at,
    p_ends_at,
    p_note,
    p_group_id,
    p_idempotency_key
  );

  if p_trial_stage is null then
    return result;
  end if;

  booking_id := (result ->> 'bookingId')::uuid;
  replayed := coalesce((result ->> 'replayed')::boolean, false);

  select operation_kind, trial_stage
    into stored_operation_kind, stored_trial_stage
  from public.bookings
  where id = booking_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;
  if stored_operation_kind <> 'trial' then
    raise exception 'trial_stage_requires_trial_operation';
  end if;
  if replayed and stored_trial_stage <> p_trial_stage then
    raise exception 'idempotency_key_conflict';
  end if;

  if not replayed then
    update public.bookings
    set trial_stage = p_trial_stage,
        updated_at = now()
    where id = booking_id
      and tenant_id = p_tenant_id;

    update public.audit_logs
    set payload = jsonb_set(
      coalesce(payload, '{}'::jsonb),
      '{trialStage}',
      to_jsonb(p_trial_stage),
      true
    )
    where tenant_id = p_tenant_id
      and action = 'bige_schedule_booking_created'
      and target_type = 'booking'
      and target_id = booking_id::text;
  end if;

  return jsonb_set(result, '{trialStage}', to_jsonb(p_trial_stage), true);
end;
$$;

revoke all on function public.bige_create_schedule_booking_v3(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking_v3(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text, text
) to authenticated, service_role;
