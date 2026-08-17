begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '11000000-0000-4000-8000-000000000001';
  branch_id uuid := '21000000-0000-4000-8000-000000000001';
  manager_id uuid := '31000000-0000-4000-8000-000000000001';
  source_coach_id uuid := '31000000-0000-4000-8000-000000000002';
  assistant_coach_id uuid := '31000000-0000-4000-8000-000000000003';
  source_member_id uuid := '41000000-0000-4000-8000-000000000001';
  assistant_member_id uuid := '41000000-0000-4000-8000-000000000002';
  schedule_start timestamptz := ((current_date + 2)::timestamp + time '15:00') at time zone 'Asia/Taipei';
  source_fa_booking_id uuid;
  assistant_booking_id uuid;
  restore_result jsonb;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'generated-to-manager@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (source_coach_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'generated-to-source@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (assistant_coach_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'generated-to-assistant@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (id, name, status)
  values (tenant_id, 'BIG E GENERATED TO TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'GENERATED TO TEST', 'GTO', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active, department, position
  )
  values
    (manager_id, tenant_id, branch_id, 'manager', 'Generated TO Manager', true, null, null),
    (source_coach_id, tenant_id, branch_id, 'coach', 'Source Coach', true, 'coaching', 'coach'),
    (assistant_coach_id, tenant_id, branch_id, 'coach', 'Assistant Manager', true, 'coaching', 'coach_assistant_manager');

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, email, birth_date, status
  )
  values
    (source_member_id, tenant_id, branch_id, 'Generated TO Source', '0911999901', 'generated-to-source-member@test.local', '1990-01-01', 'active'),
    (assistant_member_id, tenant_id, branch_id, 'Generated TO Assistant', '0911999902', 'generated-to-assistant-member@test.local', '1990-01-02', 'active');

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, source_member_id, null, source_coach_id,
    'trial', 'weight_training', schedule_start, schedule_start + interval '2 hours',
    null, null, 'test:generated-to:source-fa'
  );

  select booking.id into source_fa_booking_id
  from public.bookings booking
  where booking.operation_idempotency_key = 'test:generated-to:source-fa';

  if not exists (
    select 1
    from public.bige_schedule_notes note
    where note.tenant_id = test_block.tenant_id
      and note.coach_id = assistant_coach_id
      and note.starts_at = schedule_start + interval '1 hour'
      and note.system_kind = 'fa_assistant_to'
      and note.source_booking_ids @> array[source_fa_booking_id]
  ) then
    raise exception 'active FA should create its generated assistant TO marker';
  end if;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, assistant_member_id, null, assistant_coach_id,
    'pt', 'weight_training', schedule_start + interval '1 hour', schedule_start + interval '2 hours',
    null, null, 'test:generated-to:real-booking'
  );

  select booking.id into assistant_booking_id
  from public.bookings booking
  where booking.operation_idempotency_key = 'test:generated-to:real-booking';

  if assistant_booking_id is null then
    raise exception 'generated TO must not block a real booking';
  end if;

  if exists (
    select 1
    from public.bige_schedule_notes note
    where note.tenant_id = test_block.tenant_id
      and note.coach_id = assistant_coach_id
      and note.starts_at = schedule_start + interval '1 hour'
      and note.system_kind = 'fa_assistant_to'
  ) then
    raise exception 'generated TO should yield while the assistant manager has a real booking';
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now()
  where id = assistant_booking_id;

  if not exists (
    select 1
    from public.bige_schedule_notes note
    where note.tenant_id = test_block.tenant_id
      and note.coach_id = assistant_coach_id
      and note.starts_at = schedule_start + interval '1 hour'
      and note.system_kind = 'fa_assistant_to'
      and note.source_booking_ids @> array[source_fa_booking_id]
  ) then
    raise exception 'generated TO should return after the real booking is cancelled';
  end if;

  restore_result := public.bige_restore_cancelled_schedule_booking(
    assistant_booking_id
  );

  if coalesce((restore_result->>'restored')::boolean, false) is not true then
    raise exception 'cancelled booking should restore across a generated TO marker';
  end if;

  if not exists (
    select 1
    from public.bookings booking
    where booking.id = assistant_booking_id
      and booking.status = 'booked'
  ) then
    raise exception 'restored booking should be active';
  end if;

  if exists (
    select 1
    from public.bige_schedule_notes note
    where note.tenant_id = test_block.tenant_id
      and note.coach_id = assistant_coach_id
      and note.starts_at = schedule_start + interval '1 hour'
      and note.system_kind = 'fa_assistant_to'
  ) then
    raise exception 'restored booking should replace the generated TO marker';
  end if;

  insert into public.bige_schedule_notes (
    tenant_id, branch_id, coach_id, starts_at, ends_at, content,
    created_by, updated_by, source
  ) values (
    tenant_id, branch_id, assistant_coach_id,
    schedule_start + interval '3 hours', schedule_start + interval '4 hours',
    'TO', manager_id, manager_id, 'staff'
  );

  begin
    perform public.bige_create_schedule_booking(
      tenant_id, branch_id, source_member_id, null, assistant_coach_id,
      'pt', 'weight_training', schedule_start + interval '3 hours', schedule_start + interval '4 hours',
      null, null, 'test:manual-to:still-blocks'
    );
    raise exception 'manual TO should still block a real booking';
  exception
    when unique_violation then
      if sqlerrm <> 'schedule_time_overlap' then
        raise;
      end if;
  end;
end;
$$;

rollback;
