-- Remove the student-facing attendance PIN step while preserving the existing,
-- transactional completion and redemption implementation.
begin;

create or replace function public.bige_complete_schedule_booking_without_pin(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  booking_tenant_id uuid;
  booking_coach_id uuid;
  booking_member_id uuid;
  previous_pin_hash text;
  previous_pin_set_at timestamptz;
  previous_pin_reset_required boolean;
  compatibility_pin text;
  result jsonb;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found
     or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk', 'coach') then
    raise exception 'forbidden';
  end if;

  -- The legacy completion function still accepts a PIN. Set a transaction-local
  -- compatibility value, run the established completion logic, then restore the
  -- member record before returning. If completion raises, the statement rolls
  -- back automatically, including this temporary update.
  select
    booking.tenant_id,
    booking.coach_id,
    booking.member_id,
    member.attendance_pin_hash,
    member.attendance_pin_set_at,
    member.attendance_pin_reset_required
  into
    booking_tenant_id,
    booking_coach_id,
    booking_member_id,
    previous_pin_hash,
    previous_pin_set_at,
    previous_pin_reset_required
  from public.bookings as booking
  join public.members as member on member.id = booking.member_id
  where booking.id = p_booking_id
    and booking.is_bige_schedule = true
  for update of member;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_tenant_id then
    raise exception 'forbidden';
  end if;

  if actor.role = 'coach'
     and booking_coach_id is distinct from actor.id then
    raise exception 'coach_booking_scope_denied';
  end if;

  compatibility_pin := lpad(floor(random() * 1000000)::integer::text, 6, '0');

  update public.members
  set attendance_pin_hash = crypt(compatibility_pin, gen_salt('bf', 10)),
      attendance_pin_set_at = now(),
      attendance_pin_reset_required = false
  where id = booking_member_id;

  result := public.bige_complete_schedule_booking(p_booking_id, compatibility_pin);

  update public.members
  set attendance_pin_hash = previous_pin_hash,
      attendance_pin_set_at = previous_pin_set_at,
      attendance_pin_reset_required = previous_pin_reset_required
  where id = booking_member_id;

  return result;
end;
$$;

revoke all on function public.bige_complete_schedule_booking_without_pin(uuid) from public, anon;
grant execute on function public.bige_complete_schedule_booking_without_pin(uuid) to authenticated;

commit;
