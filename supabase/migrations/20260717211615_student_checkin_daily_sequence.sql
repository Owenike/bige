begin;

alter table public.student_check_ins
  add column if not exists daily_sequence integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by student_profile_id, local_date
      order by checked_in_at, id
    )::integer as daily_sequence,
    dense_rank() over (
      partition by student_profile_id, local_month
      order by local_date
    )::integer as month_sequence
  from public.student_check_ins
)
update public.student_check_ins as checkin
set daily_sequence = ranked.daily_sequence,
    month_sequence = ranked.month_sequence
from ranked
where checkin.id = ranked.id;

alter table public.student_check_ins
  alter column daily_sequence set not null;

alter table public.student_check_ins
  drop constraint if exists student_check_ins_daily_sequence_check;

alter table public.student_check_ins
  add constraint student_check_ins_daily_sequence_check
  check (daily_sequence > 0);

create unique index if not exists student_check_ins_profile_date_sequence_idx
  on public.student_check_ins (student_profile_id, local_date, daily_sequence);

drop function if exists public.decide_student_checkin_request(uuid, text, uuid);

create function public.decide_student_checkin_request(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid
)
returns table (
  request_status text,
  checkin_id uuid,
  daily_sequence integer,
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
  v_daily_sequence integer;
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
    select sci.id, sci.daily_sequence, sci.month_sequence, sci.checked_in_at
    into v_checkin_id, v_daily_sequence, v_month_sequence, v_now
    from public.student_check_ins sci
    where sci.request_id = p_request_id
    limit 1;

    return query select v_request.status, v_checkin_id, v_daily_sequence, v_month_sequence, v_now;
    return;
  end if;

  update public.student_checkin_requests
  set status = p_decision,
      reviewed_at = v_now,
      reviewed_by = p_reviewed_by,
      updated_at = v_now
  where id = p_request_id;

  if p_decision = 'rejected' then
    return query select 'rejected'::text, null::uuid, null::integer, null::integer, null::timestamptz;
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
  into v_daily_sequence
  from public.student_check_ins
  where student_profile_id = v_profile.id
    and local_date = v_local_date;

  select count(distinct local_date)::integer
  into v_month_sequence
  from public.student_check_ins
  where student_profile_id = v_profile.id
    and local_month = v_local_month;

  if v_daily_sequence = 1 then
    v_month_sequence := v_month_sequence + 1;
  end if;

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
    daily_sequence,
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
    v_daily_sequence,
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

  return query select 'approved'::text, v_checkin_id, v_daily_sequence, v_month_sequence, v_now;
end;
$$;

revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from public;
revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from anon;
revoke all on function public.decide_student_checkin_request(uuid, text, uuid) from authenticated;
grant execute on function public.decide_student_checkin_request(uuid, text, uuid) to service_role;

commit;
