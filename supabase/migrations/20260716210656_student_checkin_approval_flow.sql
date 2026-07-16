alter table public.student_line_profiles
  alter column line_user_id drop not null,
  add column if not exists birth_date date,
  add column if not exists password_hash text,
  add column if not exists photo_path text,
  add column if not exists is_active boolean not null default true;

alter table public.student_line_profiles
  drop constraint if exists student_line_profiles_birth_date_check;

alter table public.student_line_profiles
  add constraint student_line_profiles_birth_date_check
  check (birth_date is null or birth_date >= date '1900-01-01');

drop index if exists public.student_line_profiles_phone_idx;

create unique index if not exists student_line_profiles_phone_unique_idx
  on public.student_line_profiles (phone);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-checkin-photos',
  'student-checkin-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.student_checkin_requests (
  id uuid primary key default gen_random_uuid(),
  student_profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  auth_method text not null check (auth_method in ('line', 'phone')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_checkin_requests_one_pending_idx
  on public.student_checkin_requests (student_profile_id)
  where status = 'pending';

create index if not exists student_checkin_requests_status_time_idx
  on public.student_checkin_requests (status, requested_at desc);

alter table public.student_check_ins
  alter column line_user_id drop not null,
  add column if not exists request_id uuid references public.student_checkin_requests(id) on delete set null,
  add column if not exists birth_date date,
  add column if not exists photo_path text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

create unique index if not exists student_check_ins_request_unique_idx
  on public.student_check_ins (request_id)
  where request_id is not null;

alter table public.student_checkin_requests enable row level security;

grant all on table public.student_checkin_requests to service_role;

create or replace function public.decide_student_checkin_request(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid
)
returns table (
  request_status text,
  checkin_id uuid,
  month_sequence integer,
  checked_in_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.student_checkin_requests%rowtype;
  v_profile public.student_line_profiles%rowtype;
  v_now timestamptz := now();
  v_local_date date;
  v_local_month text;
  v_month_sequence integer;
  v_checkin_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select *
  into v_request
  from public.student_checkin_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.status <> 'pending' then
    select sci.id, sci.month_sequence, sci.checked_in_at
    into v_checkin_id, v_month_sequence, v_now
    from public.student_check_ins sci
    where sci.request_id = p_request_id
    limit 1;

    return query select v_request.status, v_checkin_id, v_month_sequence, v_now;
    return;
  end if;

  update public.student_checkin_requests
  set status = p_decision,
      reviewed_at = v_now,
      reviewed_by = p_reviewed_by,
      updated_at = v_now
  where id = p_request_id;

  if p_decision = 'rejected' then
    return query select 'rejected'::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  select *
  into v_profile
  from public.student_line_profiles
  where id = v_request.student_profile_id
  for update;

  if not found or not v_profile.is_active then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;

  v_local_date := (v_now at time zone 'Asia/Taipei')::date;
  v_local_month := to_char(v_now at time zone 'Asia/Taipei', 'YYYY-MM');

  select count(*)::integer + 1
  into v_month_sequence
  from public.student_check_ins
  where student_profile_id = v_profile.id
    and local_month = v_local_month;

  insert into public.student_check_ins (
    student_profile_id,
    line_user_id,
    request_id,
    full_name,
    phone,
    birth_date,
    photo_path,
    checked_in_at,
    local_date,
    local_month,
    month_sequence,
    source,
    user_agent,
    ip_address,
    reviewed_at,
    reviewed_by
  )
  values (
    v_profile.id,
    v_profile.line_user_id,
    v_request.id,
    v_profile.full_name,
    v_profile.phone,
    v_profile.birth_date,
    v_profile.photo_path,
    v_now,
    v_local_date,
    v_local_month,
    v_month_sequence,
    v_request.auth_method || '_approved',
    v_request.user_agent,
    v_request.ip_address,
    v_now,
    p_reviewed_by
  )
  returning id into v_checkin_id;

  update public.student_line_profiles
  set last_checkin_at = v_now,
      updated_at = v_now
  where id = v_profile.id;

  return query select 'approved'::text, v_checkin_id, v_month_sequence, v_now;
end;
$$;

revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from public;
revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from anon;
revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from authenticated;
grant execute on function public.decide_student_checkin_request(uuid, text, uuid) to service_role;
