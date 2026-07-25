-- The production schema still has the original BEFORE INSERT status logger.
-- Move creation logging to AFTER INSERT so booking_status_logs can satisfy its FK.

create or replace function public.log_booking_created()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.booking_status_logs (
    tenant_id,
    booking_id,
    from_status,
    to_status,
    actor_id,
    reason,
    payload
  )
  values (
    new.tenant_id,
    new.id,
    null,
    new.status,
    coalesce(auth.uid(), new.created_by),
    'booking_created',
    jsonb_build_object(
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'coach_id', new.coach_id,
      'branch_id', new.branch_id
    )
  );

  return new;
end;
$$;

create or replace function public.log_booking_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.status is distinct from new.status then
    new.status_updated_at = now();
    if new.status = 'confirmed' then
      new.confirmed_at = coalesce(new.confirmed_at, now());
    elsif new.status = 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    elsif new.status = 'cancelled' then
      new.cancelled_at = coalesce(new.cancelled_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_created_status_log on public.bookings;
create trigger bookings_created_status_log
after insert on public.bookings
for each row
execute function public.log_booking_created();

-- BIG E group lessons intentionally allow up to three students for one coach.
-- Keep the legacy one-booking exclusion behavior for every existing booking flow.
create or replace function public.set_booking_schedule_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_timing record;
begin
  if coalesce(new.is_bige_schedule, false) then
    new.occupied_starts_at := null;
    new.occupied_ends_at := null;
    new.coach_conflict_scope := null;
    return new;
  end if;

  if new.starts_at is null or new.ends_at is null then
    new.occupied_starts_at := new.starts_at;
    new.occupied_ends_at := new.ends_at;
    new.coach_conflict_scope := public.resolve_booking_conflict_scope(new.tenant_id, new.branch_id, new.coach_id);
    return new;
  end if;

  select *
  into v_timing
  from public.resolve_booking_service_timing(
    new.tenant_id,
    new.branch_id,
    new.service_name,
    new.starts_at,
    new.ends_at
  )
  limit 1;

  new.occupied_starts_at :=
    new.starts_at - make_interval(mins => greatest(0, coalesce(v_timing.pre_buffer_minutes, 0)));
  new.occupied_ends_at :=
    new.ends_at + make_interval(mins => greatest(0, coalesce(v_timing.post_buffer_minutes, 0)));
  new.coach_conflict_scope :=
    public.resolve_booking_conflict_scope(new.tenant_id, new.branch_id, new.coach_id);
  return new;
end;
$$;
