alter table public.bookings
  alter column member_id drop not null;

create or replace function public.create_public_booking(
  p_branch_id uuid default null,
  p_branch_code text default null,
  p_service_name text default null,
  p_coach_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_note text default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_email text default null
)
returns table (
  id uuid,
  public_reference text,
  status text,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch public.branches%rowtype;
  v_booking public.bookings%rowtype;
  v_note text;
begin
  p_service_name := nullif(btrim(coalesce(p_service_name, '')), '');
  p_customer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  p_customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');
  p_customer_email := nullif(btrim(coalesce(p_customer_email, '')), '');
  p_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_service_name is null then
    raise exception 'service_name_required';
  end if;
  if p_customer_name is null then
    raise exception 'customer_name_required';
  end if;
  if p_customer_phone is null then
    raise exception 'customer_phone_required';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_booking_time';
  end if;
  if p_starts_at <= now() then
    raise exception 'booking_must_be_future';
  end if;

  select *
  into v_branch
  from public.branches b
  where b.is_active = true
    and (p_branch_id is null or b.id = p_branch_id)
    and (p_branch_code is null or b.code = p_branch_code)
  order by b.created_at asc
  limit 1;

  if not found then
    raise exception 'booking_branch_not_found';
  end if;

  if p_coach_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = p_coach_id
      and p.tenant_id = v_branch.tenant_id
      and p.is_active = true
      and p.role in ('coach', 'therapist')
  ) then
    raise exception 'coach_not_available';
  end if;

  if p_coach_id is not null and exists (
    select 1
    from public.bookings b
    where b.tenant_id = v_branch.tenant_id
      and b.coach_id = p_coach_id
      and b.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and b.starts_at < p_ends_at
      and b.ends_at > p_starts_at
  ) then
    raise exception 'coach_time_conflict';
  end if;

  v_note := p_note;
  if p_customer_email is not null then
    v_note := concat_ws(E'\n', v_note, 'Email: ' || p_customer_email);
  end if;

  insert into public.bookings (
    tenant_id,
    branch_id,
    member_id,
    coach_id,
    service_name,
    starts_at,
    ends_at,
    status,
    note,
    source,
    customer_name,
    customer_phone,
    customer_note
  )
  values (
    v_branch.tenant_id,
    v_branch.id,
    null,
    p_coach_id,
    p_service_name,
    p_starts_at,
    p_ends_at,
    'booked',
    v_note,
    'public',
    p_customer_name,
    p_customer_phone,
    v_note
  )
  returning * into v_booking;

  return query
  select
    v_booking.id,
    v_booking.public_reference,
    v_booking.status,
    v_booking.service_name,
    v_booking.starts_at,
    v_booking.ends_at;
end;
$$;

revoke all on function public.create_public_booking(uuid, text, text, uuid, timestamptz, timestamptz, text, text, text, text) from public;
grant execute on function public.create_public_booking(uuid, text, text, uuid, timestamptz, timestamptz, text, text, text, text) to anon, authenticated;
