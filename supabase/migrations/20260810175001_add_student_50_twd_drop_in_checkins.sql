-- Ten-use NT$50 drop-in program for student check-in accounts.
-- Identity photos remain on student_line_profiles; the review proof belongs to
-- the drop-in entitlement and is reusable for all ten approved visits.

create table if not exists public.student_drop_in_entitlements (
  student_profile_id uuid primary key references public.student_line_profiles(id) on delete cascade,
  total_uses smallint not null default 10,
  used_uses smallint not null default 0,
  review_photo_path text,
  review_photo_uploaded_at timestamptz,
  review_photo_uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_drop_in_entitlements_total_uses_check check (total_uses = 10),
  constraint student_drop_in_entitlements_used_uses_check check (used_uses between 0 and total_uses),
  constraint student_drop_in_entitlements_review_photo_check check (
    (review_photo_path is null and review_photo_uploaded_at is null)
    or (review_photo_path is not null and review_photo_uploaded_at is not null)
  )
);

insert into public.student_drop_in_entitlements (student_profile_id)
select id
from public.student_line_profiles
on conflict (student_profile_id) do nothing;

create table if not exists public.student_drop_in_requests (
  id uuid primary key default gen_random_uuid(),
  student_profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  status text not null default 'pending',
  auth_method text not null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_drop_in_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint student_drop_in_requests_auth_method_check check (auth_method in ('phone', 'passkey'))
);

create index if not exists student_drop_in_requests_profile_idx
  on public.student_drop_in_requests (student_profile_id);

create unique index if not exists student_drop_in_requests_one_pending_idx
  on public.student_drop_in_requests (student_profile_id)
  where status = 'pending';

create index if not exists student_drop_in_requests_status_time_idx
  on public.student_drop_in_requests (status, requested_at desc);

create table if not exists public.student_drop_ins (
  id uuid primary key default gen_random_uuid(),
  student_profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  request_id uuid not null references public.student_drop_in_requests(id) on delete cascade,
  full_name text not null,
  phone text not null,
  birth_date date,
  photo_path text not null,
  review_photo_path text not null,
  checked_in_at timestamptz not null default now(),
  local_date date not null,
  use_sequence smallint not null,
  remaining_uses smallint not null,
  price_twd smallint not null default 50,
  reviewed_at timestamptz not null,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  constraint student_drop_ins_request_unique unique (request_id),
  constraint student_drop_ins_use_sequence_check check (use_sequence between 1 and 10),
  constraint student_drop_ins_remaining_uses_check check (remaining_uses between 0 and 9),
  constraint student_drop_ins_price_twd_check check (price_twd = 50)
);

create index if not exists student_drop_ins_profile_time_idx
  on public.student_drop_ins (student_profile_id, checked_in_at desc);

create index if not exists student_drop_ins_local_date_time_idx
  on public.student_drop_ins (local_date, checked_in_at desc);

alter table public.student_drop_in_entitlements enable row level security;
alter table public.student_drop_in_requests enable row level security;
alter table public.student_drop_ins enable row level security;

revoke all on table public.student_drop_in_entitlements from public, anon, authenticated;
revoke all on table public.student_drop_in_requests from public, anon, authenticated;
revoke all on table public.student_drop_ins from public, anon, authenticated;

grant select, insert, update, delete on table public.student_drop_in_entitlements to service_role;
grant select, insert, update, delete on table public.student_drop_in_requests to service_role;
grant select, insert, update, delete on table public.student_drop_ins to service_role;

create or replace function public.decide_student_drop_in_request(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid
)
returns table (
  request_status text,
  drop_in_id uuid,
  use_sequence integer,
  remaining_uses integer,
  checked_in_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.student_drop_in_requests%rowtype;
  v_profile public.student_line_profiles%rowtype;
  v_entitlement public.student_drop_in_entitlements%rowtype;
  v_drop_in public.student_drop_ins%rowtype;
  v_now timestamptz := now();
  v_use_sequence integer;
  v_remaining_uses integer;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select *
  into v_request
  from public.student_drop_in_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.status <> 'pending' then
    select *
    into v_drop_in
    from public.student_drop_ins
    where request_id = p_request_id;

    select greatest(total_uses - used_uses, 0)
    into v_remaining_uses
    from public.student_drop_in_entitlements
    where student_profile_id = v_request.student_profile_id;

    return query select
      v_request.status,
      v_drop_in.id,
      v_drop_in.use_sequence::integer,
      coalesce(v_drop_in.remaining_uses::integer, v_remaining_uses),
      v_drop_in.checked_in_at;
    return;
  end if;

  insert into public.student_drop_in_entitlements (student_profile_id)
  values (v_request.student_profile_id)
  on conflict (student_profile_id) do nothing;

  select *
  into v_entitlement
  from public.student_drop_in_entitlements
  where student_profile_id = v_request.student_profile_id
  for update;

  if p_decision = 'rejected' then
    update public.student_drop_in_requests
    set status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = p_reviewed_by,
        updated_at = v_now
    where id = p_request_id;

    return query select
      'rejected'::text,
      null::uuid,
      null::integer,
      (v_entitlement.total_uses - v_entitlement.used_uses)::integer,
      null::timestamptz;
    return;
  end if;

  select *
  into v_profile
  from public.student_line_profiles
  where id = v_request.student_profile_id;

  if not found or not v_profile.is_active then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;
  if v_profile.photo_path is null then
    raise exception 'PROFILE_PHOTO_REQUIRED';
  end if;
  if v_entitlement.review_photo_path is null then
    raise exception 'REVIEW_PHOTO_REQUIRED';
  end if;
  if v_entitlement.used_uses >= v_entitlement.total_uses then
    raise exception 'DROP_IN_USES_EXHAUSTED';
  end if;

  v_use_sequence := v_entitlement.used_uses + 1;
  v_remaining_uses := v_entitlement.total_uses - v_use_sequence;

  update public.student_drop_in_entitlements
  set used_uses = v_use_sequence,
      updated_at = v_now
  where student_profile_id = v_entitlement.student_profile_id;

  update public.student_drop_in_requests
  set status = 'approved',
      reviewed_at = v_now,
      reviewed_by = p_reviewed_by,
      updated_at = v_now
  where id = p_request_id;

  insert into public.student_drop_ins (
    student_profile_id,
    request_id,
    full_name,
    phone,
    birth_date,
    photo_path,
    review_photo_path,
    checked_in_at,
    local_date,
    use_sequence,
    remaining_uses,
    price_twd,
    reviewed_at,
    reviewed_by
  )
  values (
    v_profile.id,
    v_request.id,
    v_profile.full_name,
    v_profile.phone,
    v_profile.birth_date,
    v_profile.photo_path,
    v_entitlement.review_photo_path,
    v_now,
    (v_now at time zone 'Asia/Taipei')::date,
    v_use_sequence,
    v_remaining_uses,
    50,
    v_now,
    p_reviewed_by
  )
  returning * into v_drop_in;

  return query select
    'approved'::text,
    v_drop_in.id,
    v_use_sequence,
    v_remaining_uses,
    v_now;
end;
$$;

revoke all on function public.decide_student_drop_in_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.decide_student_drop_in_request(uuid, text, uuid) to service_role;
