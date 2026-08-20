begin;

-- Store the first moment a trial was successfully scheduled. created_at is the
-- lead creation time and updated_at changes on every later edit, so neither can
-- reliably answer "how many successful FA appointments were made that day".
alter table public.trial_bookings
  add column if not exists scheduled_at timestamptz;

update public.trial_bookings trial
set scheduled_at = coalesce(
  (
    select min(booking.created_at)
    from public.bookings booking
    where booking.trial_booking_id = trial.id
      and booking.is_bige_schedule = true
      and booking.operation_kind = 'trial'
  ),
  trial.updated_at,
  trial.created_at
)
where trial.scheduled_at is null
  and trial.appointment_date is not null
  and nullif(btrim(coalesce(trial.booking_coach, '')), '') is not null;

create or replace function public.trial_booking_capture_first_scheduled_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.scheduled_at is null
     and new.appointment_date is not null
     and nullif(btrim(coalesce(new.booking_coach, '')), '') is not null then
    new.scheduled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trial_bookings_capture_first_scheduled_at on public.trial_bookings;
create trigger trial_bookings_capture_first_scheduled_at
before insert or update of appointment_date, booking_coach, scheduled_at
on public.trial_bookings
for each row
execute function public.trial_booking_capture_first_scheduled_at();

comment on column public.trial_bookings.scheduled_at is
  'First successful scheduling time. Preserved across later edits and reschedules.';

-- BB (Be Back) is a follow-up visit tied to an already completed, non-converted
-- FA. It occupies the coach calendar but is intentionally neither a formal
-- course nor an FA, and therefore has its own conversion outcome.
alter table public.bookings
  drop constraint if exists bookings_operation_kind_check;
alter table public.bookings
  add constraint bookings_operation_kind_check
  check (operation_kind is null or operation_kind in ('pt', 'trial', 'bb'));

alter table public.bookings
  add column if not exists bb_conversion_outcome text;
alter table public.bookings
  drop constraint if exists bookings_bb_conversion_outcome_check;
alter table public.bookings
  add constraint bookings_bb_conversion_outcome_check
  check (
    (operation_kind = 'bb' and bb_conversion_outcome in ('converted', 'not_converted'))
    or bb_conversion_outcome is null
  );

alter table public.bookings
  drop constraint if exists bookings_bb_shape_check;
alter table public.bookings
  add constraint bookings_bb_shape_check
  check (
    operation_kind <> 'bb'
    or (
      is_bige_schedule = true
      and course_type is null
      and trial_stage is null
      and trial_booking_id is not null
      and extract(epoch from (ends_at - starts_at)) / 60 in (30, 60, 90, 120)
    )
  );

create index if not exists bookings_bb_trial_date_idx
  on public.bookings(tenant_id, trial_booking_id, starts_at)
  where operation_kind = 'bb';

alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_sales_origin_kind_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_sales_origin_kind_check
  check (sales_origin_kind is null or sales_origin_kind in ('fa', 'bb', 'renewal', 'manual'));

alter table public.staff_sales_events
  drop constraint if exists staff_sales_events_source_type_check;
alter table public.staff_sales_events
  add constraint staff_sales_events_source_type_check
  check (source_type in ('fa', 'bb', 'renewal', 'final_payment', 'refund', 'manual_adjustment'));

comment on column public.bookings.bb_conversion_outcome is
  'BB result kept separate from FA conversion. A scheduled BB is null; a completed visit is converted or not_converted.';

-- BB must exclusively occupy the coach and member time range. The established
-- group-course trigger still governs PT/FA; this focused trigger prevents BB
-- from sharing a same-course group cell or being treated as classroom work.
create or replace function public.bige_enforce_bb_exclusive_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_bige_schedule is distinct from true
     or new.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.tenant_id::text || ':' || new.coach_id::text || ':' ||
      ((new.starts_at at time zone 'Asia/Taipei')::date)::text,
      0
    )
  );

  if new.operation_kind = 'bb' and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = new.tenant_id
      and booking.id <> new.id
      and booking.coach_id = new.coach_id
      and booking.is_bige_schedule = true
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule_time_overlap' using errcode = '23505';
  end if;

  if new.operation_kind <> 'bb' and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = new.tenant_id
      and booking.id <> new.id
      and booking.coach_id = new.coach_id
      and booking.is_bige_schedule = true
      and booking.operation_kind = 'bb'
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule_time_overlap' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_bige_bb_exclusive_schedule on public.bookings;
create trigger bookings_bige_bb_exclusive_schedule
before insert or update of tenant_id, coach_id, member_id, starts_at, ends_at,
  status, is_bige_schedule, operation_kind
on public.bookings
for each row
execute function public.bige_enforce_bb_exclusive_schedule();

revoke all on function public.bige_enforce_bb_exclusive_schedule() from public, anon, authenticated;

create or replace function public.bige_create_bb_schedule_booking_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_trial_booking_id uuid,
  p_coach_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  trial_row public.trial_bookings%rowtype;
  original_fa public.bookings%rowtype;
  member_row public.members%rowtype;
  existing_booking public.bookings%rowtype;
  created_booking public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  local_day date;
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
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;
  if extract(epoch from (p_ends_at - p_starts_at)) / 60 not in (30, 60, 90, 120) then
    raise exception 'invalid_bb_duration';
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

  select * into existing_booking
  from public.bookings
  where tenant_id = p_tenant_id
    and operation_idempotency_key = p_idempotency_key
  limit 1;
  if found then
    if existing_booking.operation_kind <> 'bb'
       or existing_booking.trial_booking_id is distinct from p_trial_booking_id then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'bookingId', existing_booking.id,
      'memberId', existing_booking.member_id,
      'trialStage', null,
      'groupId', existing_booking.group_id,
      'warnings', '[]'::jsonb,
      'replayed', true
    );
  end if;

  select * into trial_row
  from public.trial_bookings
  where id = p_trial_booking_id
  for share;
  if not found then raise exception 'trial_booking_not_found'; end if;

  select * into original_fa
  from public.bookings
  where tenant_id = p_tenant_id
    and trial_booking_id = p_trial_booking_id
    and operation_kind = 'trial'
    and status = 'completed'
    and trial_conversion_outcome = 'not_converted'
    and converted_at is null
  order by starts_at desc, created_at desc
  limit 1
  for share;
  if not found then raise exception 'bb_completed_non_converted_fa_required'; end if;

  select * into member_row
  from public.members
  where id = original_fa.member_id and tenant_id = p_tenant_id
  for share;
  if not found then raise exception 'member_not_found'; end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_coach_id
      and profile.tenant_id = p_tenant_id
      and profile.is_active = true
  ) then raise exception 'coach_not_found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_coach_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || member_row.id::text, 0));

  if exists (
    select 1 from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.coach_id = p_coach_id
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'schedule_time_overlap'; end if;

  if exists (
    select 1 from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.member_id = member_row.id
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'member_time_conflict'; end if;

  insert into public.bookings (
    tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at,
    status, note, customer_name, customer_phone, source, payment_status,
    booking_payment_mode, created_by, is_bige_schedule, operation_kind,
    course_type, trial_stage, trial_booking_id, group_id,
    operation_idempotency_key, coach_conflict_scope, occupied_starts_at,
    occupied_ends_at
  ) values (
    p_tenant_id, p_branch_id, member_row.id, p_coach_id, 'BB 回訪', p_starts_at,
    p_ends_at, 'booked', nullif(btrim(coalesce(p_note, '')), ''),
    member_row.full_name, member_row.phone, 'staff', 'unpaid', 'package', actor.id,
    true, 'bb', null, null, p_trial_booking_id, gen_random_uuid(),
    p_idempotency_key, null, null, null
  ) returning * into created_booking;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_bb_schedule_booking_created', 'booking',
    created_booking.id::text, null,
    jsonb_build_object(
      'operationKind', 'bb',
      'coachId', p_coach_id,
      'memberId', member_row.id,
      'trialBookingId', p_trial_booking_id,
      'originalFaBookingId', original_fa.id,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at
    )
  );

  return jsonb_build_object(
    'bookingId', created_booking.id,
    'memberId', created_booking.member_id,
    'trialStage', null,
    'groupId', created_booking.group_id,
    'warnings', '[]'::jsonb,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_create_bb_schedule_booking_v1(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_create_bb_schedule_booking_v1(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text
) to authenticated, service_role;

-- Keep the public schedule API stable while routing BB to its stricter path.
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
    return public.bige_create_bb_schedule_booking_v1(
      p_tenant_id, p_branch_id, p_trial_booking_id, p_coach_id,
      p_starts_at, p_ends_at, p_note, p_idempotency_key
    );
  end if;

  if p_operation_kind not in ('pt', 'trial') then raise exception 'invalid_operation_kind'; end if;
  if p_course_type not in (
    'weight_training', 'relaxation', 'reformer_pilates',
    'sports_cupping', 'fascia_knife', 'onsite_assessment'
  ) then raise exception 'invalid_course_type'; end if;

  if p_course_type in ('weight_training', 'relaxation', 'reformer_pilates') then
    return public.bige_create_schedule_booking(
      p_tenant_id, p_branch_id, p_member_id, p_trial_booking_id, p_coach_id,
      p_operation_kind, p_course_type, p_starts_at, p_ends_at, p_note,
      p_group_id, p_idempotency_key
    );
  end if;

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
  return result;
end;
$$;

revoke all on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated, service_role;

create or replace function public.bige_complete_bb_outcome_v1(
  p_booking_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active = true;
  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;
  if p_outcome <> 'not_converted' then raise exception 'invalid_bb_conversion_outcome'; end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id and is_bige_schedule = true and operation_kind = 'bb'
  for update;
  if not found then raise exception 'bb_booking_not_found'; end if;
  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;
  if booking_row.converted_at is not null then raise exception 'bb_already_converted'; end if;
  if booking_row.status not in ('pending', 'confirmed', 'booked', 'checked_in', 'completed') then
    raise exception 'booking_not_active';
  end if;

  update public.bookings
  set status = 'completed', operation_result = 'completed',
      bb_conversion_outcome = 'not_converted',
      completed_at = coalesce(completed_at, now()), status_updated_at = now(), updated_at = now()
  where id = booking_row.id
  returning * into booking_row;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id, actor.id, 'bige_bb_outcome_recorded', 'booking',
    booking_row.id::text, 'not_converted',
    jsonb_build_object('trialBookingId', booking_row.trial_booking_id, 'memberId', booking_row.member_id)
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', booking_row.status,
    'operationResult', booking_row.operation_result,
    'bbConversionOutcome', booking_row.bb_conversion_outcome
  );
end;
$$;

revoke all on function public.bige_complete_bb_outcome_v1(uuid, text) from public, anon;
grant execute on function public.bige_complete_bb_outcome_v1(uuid, text) to authenticated;

-- Extend only the origin wrapper. BB then uses the existing, fully validated
-- member/plan/payment machinery while preserving a distinct sales origin.
create or replace function public.bige_create_member_contract_v5(
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
  p_installment_count integer,
  p_payment_schedule jsonb,
  p_future_trial_action text,
  p_fa_fee_recipient_profile_id uuid,
  p_fa_fee_recipient_name text,
  p_sales_origin_coach_id uuid,
  p_sales_origin_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
  created_contract_id uuid;
begin
  if p_sales_origin_kind not in ('fa', 'bb', 'renewal', 'manual') then
    raise exception 'sales_origin_kind_invalid';
  end if;
  if p_sales_origin_coach_id is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = p_sales_origin_coach_id
      and profile.tenant_id = p_tenant_id
      and profile.is_active = true
      and (
        profile.role in ('coach', 'therapist')
        or profile.position in ('coach', 'coach_team_lead', 'coach_director', 'coach_assistant_manager', 'coach_manager', 'coach_city_manager')
      )
  ) then raise exception 'sales_origin_coach_invalid'; end if;

  contract_result := public.bige_create_member_contract_v4(
    p_tenant_id, p_branch_id, p_member_id, p_source_booking_id,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payment_method, p_installment_count,
    p_payment_schedule, p_future_trial_action,
    p_fa_fee_recipient_profile_id, p_fa_fee_recipient_name
  );

  created_contract_id := (contract_result->>'contractId')::uuid;
  update public.member_plan_contracts
  set sales_origin_coach_id = p_sales_origin_coach_id,
      sales_origin_kind = p_sales_origin_kind,
      updated_at = now()
  where id = created_contract_id and tenant_id = p_tenant_id;
  if not found then raise exception 'contract_sales_origin_update_failed'; end if;

  return contract_result || jsonb_build_object(
    'salesOriginCoachId', p_sales_origin_coach_id,
    'salesOriginKind', p_sales_origin_kind
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v5(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v5(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text, uuid, text
) to authenticated;

create or replace function public.bige_create_bb_member_contract_v1(
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
  p_payment_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_booking public.bookings%rowtype;
  contract_result jsonb;
  created_contract_id uuid;
  created_member_id uuid;
begin
  select * into source_booking
  from public.bookings booking
  where booking.id = p_source_booking_id
    and booking.tenant_id = p_tenant_id
    and booking.is_bige_schedule = true
    and booking.operation_kind = 'bb'
  for update;
  if not found then raise exception 'bb_booking_not_found'; end if;
  if source_booking.converted_at is not null then raise exception 'bb_already_converted'; end if;
  if source_booking.status not in ('pending', 'confirmed', 'booked', 'checked_in', 'completed') then
    raise exception 'booking_not_active';
  end if;
  if source_booking.member_id is null or source_booking.trial_booking_id is null then
    raise exception 'bb_source_incomplete';
  end if;
  if p_member_id is not null and p_member_id is distinct from source_booking.member_id then
    raise exception 'bb_member_mismatch';
  end if;
  if p_initial_payment <= 0 then raise exception 'bb_payment_required'; end if;

  contract_result := public.bige_create_member_contract_v6(
    p_tenant_id, p_branch_id, source_booking.member_id, null,
    p_full_name, p_phone, p_birth_date, p_email, p_email_unavailable,
    p_plan_mode, p_plan_id, p_custom_plan, p_signed_on, p_pin,
    p_initial_payment, p_payments, p_payment_schedule, 'none',
    null, null, source_booking.coach_id, 'bb', source_booking.id
  );

  created_contract_id := (contract_result->>'contractId')::uuid;
  created_member_id := (contract_result->>'memberId')::uuid;

  update public.member_plan_contracts
  set source_trial_booking_id = source_booking.trial_booking_id,
      converted_from_booking_id = source_booking.id,
      updated_at = now()
  where id = created_contract_id and tenant_id = p_tenant_id;
  if not found then raise exception 'bb_contract_link_failed'; end if;

  update public.bookings
  set member_id = created_member_id,
      status = 'completed', operation_result = 'completed',
      bb_conversion_outcome = 'converted',
      converted_at = now(), converted_contract_id = created_contract_id,
      completed_at = coalesce(completed_at, now()),
      status_updated_at = now(), updated_at = now()
  where id = source_booking.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, auth.uid(), 'bige_bb_converted_to_member',
    'member_plan_contract', created_contract_id::text, 'bb',
    jsonb_build_object(
      'bookingId', source_booking.id,
      'trialBookingId', source_booking.trial_booking_id,
      'memberId', created_member_id,
      'initialPayment', p_initial_payment,
      'epoEligible', false
    )
  );

  return contract_result || jsonb_build_object(
    'sourceBookingId', source_booking.id,
    'bbConversionOutcome', 'converted'
  );
end;
$$;

revoke all on function public.bige_create_bb_member_contract_v1(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, jsonb, jsonb
) from public, anon;
grant execute on function public.bige_create_bb_member_contract_v1(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, jsonb, jsonb
) to authenticated;

create or replace function public.staff_seed_default_allocation_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_employee_id uuid,
  p_amount numeric,
  p_remaining_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;
  if not found
    or target_event.status <> 'unassigned'
    or target_event.active_allocation_version <> 0
    or target_event.source_type not in ('fa', 'bb', 'renewal')
  then return false; end if;
  if p_amount <= 0 or round(p_amount + p_remaining_amount, 2) <> round(target_event.amount, 2) then
    raise exception 'default_allocation_amount_invalid';
  end if;
  insert into public.staff_sales_allocations (
    tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
    allocation_kind, status, proposed_by
  ) values (
    p_tenant_id, target_event.branch_id, target_event.id, 1, p_employee_id,
    round(p_amount, 2), 'origin_default', 'pending_manager', p_actor_id
  );
  update public.staff_sales_events
  set active_allocation_version = 1,
      allocation_note = format('原成交教練已預設 50%%，尚餘 %s 元待分配', round(p_remaining_amount, 2))
  where id = target_event.id;
  return true;
end;
$$;

revoke all on function public.staff_seed_default_allocation_v1(
  uuid, uuid, uuid, uuid, numeric, numeric
) from public, anon;
grant execute on function public.staff_seed_default_allocation_v1(
  uuid, uuid, uuid, uuid, numeric, numeric
) to service_role;

commit;
