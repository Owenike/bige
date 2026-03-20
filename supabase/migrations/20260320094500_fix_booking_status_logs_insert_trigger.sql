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
