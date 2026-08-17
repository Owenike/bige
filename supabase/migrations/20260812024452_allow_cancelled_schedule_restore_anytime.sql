begin;

-- Restoring a cancelled schedule reverses an administrative cancellation and
-- does not complete attendance or consume a session. Authorized schedule
-- managers may therefore restore it at any time; conflict checks still apply.
create or replace function public.bige_restore_cancelled_schedule_booking(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  local_business_date date;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or not public.bige_profile_can_manage_schedule(actor) then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if booking_row.status <> 'cancelled' then
    raise exception 'cancellation_restore_not_available';
  end if;

  if booking_row.member_id is not null and exists (
    select 1
    from public.bookings other_booking
    where other_booking.tenant_id = booking_row.tenant_id
      and other_booking.member_id = booking_row.member_id
      and other_booking.id <> booking_row.id
      and other_booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(other_booking.starts_at, other_booking.ends_at, '[)')
        && tstzrange(booking_row.starts_at, booking_row.ends_at, '[)')
  ) then
    raise exception 'member_time_conflict';
  end if;

  update public.bookings
  set status = 'booked',
      operation_result = null,
      completed_at = null,
      cancelled_at = null,
      status_updated_at = now(),
      status_reason = 'cancellation_reversed',
      updated_at = now()
  where id = booking_row.id;

  local_business_date := (booking_row.starts_at at time zone 'Asia/Taipei')::date;
  update public.bige_daily_closures
  set status = 'reopened',
      revision = revision + 1,
      reopened_by = actor.id,
      reopened_at = now(),
      reopen_reason = 'booking_cancellation_reversed_after_confirmation',
      confirmed_by = null,
      confirmed_at = null,
      updated_at = now()
  where tenant_id = booking_row.tenant_id
    and business_date = local_business_date
    and status = 'confirmed'
    and (branch_id is not distinct from booking_row.branch_id);

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id,
    actor.id,
    'fitness_session_cancellation_reversed',
    'booking',
    booking_row.id::text,
    'cancellation_reversed',
    jsonb_build_object(
      'memberId', booking_row.member_id,
      'coachId', booking_row.coach_id,
      'courseType', booking_row.course_type,
      'startsAt', booking_row.starts_at,
      'endsAt', booking_row.ends_at,
      'previousOperationResult', booking_row.operation_result,
      'previousStatusReason', booking_row.status_reason
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'restored', true,
    'status', 'booked'
  );
end;
$$;

revoke all on function public.bige_restore_cancelled_schedule_booking(uuid) from public, anon;
grant execute on function public.bige_restore_cancelled_schedule_booking(uuid) to authenticated;

commit;
