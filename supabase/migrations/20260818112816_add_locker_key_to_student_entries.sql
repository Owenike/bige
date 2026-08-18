begin;

alter table public.student_check_ins
  add column if not exists locker_key_taken boolean,
  add column if not exists locker_key_number integer;

alter table public.student_check_ins
  drop constraint if exists student_check_ins_locker_key_check;

alter table public.student_check_ins
  add constraint student_check_ins_locker_key_check
  check (
    (locker_key_taken is null and locker_key_number is null)
    or (locker_key_taken = false and locker_key_number is null)
    or (locker_key_taken = true and locker_key_number between 1 and 9999)
  );

alter table public.student_drop_ins
  add column if not exists locker_key_taken boolean,
  add column if not exists locker_key_number integer;

alter table public.student_drop_ins
  drop constraint if exists student_drop_ins_locker_key_check;

alter table public.student_drop_ins
  add constraint student_drop_ins_locker_key_check
  check (
    (locker_key_taken is null and locker_key_number is null)
    or (locker_key_taken = false and locker_key_number is null)
    or (locker_key_taken = true and locker_key_number between 1 and 9999)
  );

comment on column public.student_check_ins.locker_key_taken is
  'Whether the member took a locker key when this autonomous-training entry was approved. Null marks legacy entries.';
comment on column public.student_check_ins.locker_key_number is
  'Locker key number issued for this autonomous-training entry.';
comment on column public.student_drop_ins.locker_key_taken is
  'Whether the member took a locker key when this drop-in entry was approved. Null marks legacy entries.';
comment on column public.student_drop_ins.locker_key_number is
  'Locker key number issued for this drop-in entry.';

create or replace function public.decide_student_checkin_request_v2(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid,
  p_locker_key_taken boolean,
  p_locker_key_number integer
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
  if p_decision = 'approved' and p_locker_key_taken is null then
    raise exception 'LOCKER_KEY_SELECTION_REQUIRED';
  end if;
  if p_decision = 'approved'
     and p_locker_key_taken = true
     and (p_locker_key_number is null or p_locker_key_number not between 1 and 9999) then
    raise exception 'INVALID_LOCKER_KEY_NUMBER';
  end if;
  if p_decision = 'approved' and p_locker_key_taken = false and p_locker_key_number is not null then
    raise exception 'INVALID_LOCKER_KEY_NUMBER';
  end if;
  if p_decision = 'rejected' and (p_locker_key_taken is not null or p_locker_key_number is not null) then
    raise exception 'INVALID_LOCKER_KEY_SELECTION';
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
    reviewed_by,
    locker_key_taken,
    locker_key_number
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
    p_reviewed_by,
    p_locker_key_taken,
    p_locker_key_number
  )
  returning id into v_checkin_id;

  update public.student_line_profiles
  set last_checkin_at = v_now,
      updated_at = v_now
  where id = v_profile.id;

  return query select 'approved'::text, v_checkin_id, v_daily_sequence, v_month_sequence, v_now;
end;
$$;

revoke all on function public.decide_student_checkin_request_v2(uuid, text, uuid, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.decide_student_checkin_request_v2(uuid, text, uuid, boolean, integer)
  to service_role;

create or replace function public.decide_student_drop_in_request_v3(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid,
  p_rejection_action text,
  p_locker_key_taken boolean,
  p_locker_key_number integer
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
  if p_decision = 'rejected'
     and (p_rejection_action is null or p_rejection_action not in ('general', 'data_correction')) then
    raise exception 'INVALID_REJECTION_ACTION';
  end if;
  if p_decision = 'approved' and p_rejection_action is not null then
    raise exception 'INVALID_REJECTION_ACTION';
  end if;
  if p_decision = 'approved' and p_locker_key_taken is null then
    raise exception 'LOCKER_KEY_SELECTION_REQUIRED';
  end if;
  if p_decision = 'approved'
     and p_locker_key_taken = true
     and (p_locker_key_number is null or p_locker_key_number not between 1 and 9999) then
    raise exception 'INVALID_LOCKER_KEY_NUMBER';
  end if;
  if p_decision = 'approved' and p_locker_key_taken = false and p_locker_key_number is not null then
    raise exception 'INVALID_LOCKER_KEY_NUMBER';
  end if;
  if p_decision = 'rejected' and (p_locker_key_taken is not null or p_locker_key_number is not null) then
    raise exception 'INVALID_LOCKER_KEY_SELECTION';
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

    select case
      when entry_plan = 'standard_100' then null
      else greatest(total_uses - used_uses, 0)
    end
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
        rejection_action = p_rejection_action,
        reviewed_at = v_now,
        reviewed_by = p_reviewed_by,
        updated_at = v_now
    where id = p_request_id;

    if p_rejection_action = 'data_correction' then
      update public.student_drop_in_entitlements
      set registration_correction_required = true,
          correction_requested_at = v_now,
          updated_at = v_now
      where student_profile_id = v_request.student_profile_id;
    end if;

    return query select
      'rejected'::text,
      null::uuid,
      null::integer,
      case
        when v_entitlement.entry_plan = 'standard_100' then null
        else (v_entitlement.total_uses - v_entitlement.used_uses)::integer
      end,
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
  if v_entitlement.registration_correction_required then
    raise exception 'DROP_IN_REGISTRATION_REQUIRED';
  end if;
  if v_profile.photo_path is null then
    raise exception 'PROFILE_PHOTO_REQUIRED';
  end if;
  if v_entitlement.entry_plan = 'review_50' and v_entitlement.review_photo_path is null then
    raise exception 'REVIEW_PHOTO_REQUIRED';
  end if;
  if v_entitlement.entry_plan = 'review_50'
     and v_entitlement.used_uses >= v_entitlement.total_uses then
    raise exception 'DROP_IN_USES_EXHAUSTED';
  end if;

  v_use_sequence := v_entitlement.used_uses + 1;
  v_remaining_uses := case
    when v_entitlement.entry_plan = 'standard_100' then null
    else v_entitlement.total_uses - v_use_sequence
  end;

  update public.student_drop_in_entitlements
  set used_uses = v_use_sequence,
      updated_at = v_now
  where student_profile_id = v_entitlement.student_profile_id;

  update public.student_drop_in_requests
  set status = 'approved',
      rejection_action = null,
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
    entry_plan,
    reviewed_at,
    reviewed_by,
    locker_key_taken,
    locker_key_number
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
    case when v_entitlement.entry_plan = 'standard_100' then 100 else 50 end,
    v_entitlement.entry_plan,
    v_now,
    p_reviewed_by,
    p_locker_key_taken,
    p_locker_key_number
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

revoke all on function public.decide_student_drop_in_request_v3(uuid, text, uuid, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.decide_student_drop_in_request_v3(uuid, text, uuid, text, boolean, integer)
  to service_role;

commit;
