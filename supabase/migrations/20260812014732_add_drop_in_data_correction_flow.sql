-- Distinguish a normal rejection from a rejection that asks the visitor to
-- reopen and resubmit all editable NT$50 registration fields.

alter table public.student_drop_in_entitlements
  add column if not exists registration_correction_required boolean not null default false,
  add column if not exists correction_requested_at timestamptz;

alter table public.student_drop_in_entitlements
  drop constraint if exists student_drop_in_entitlements_correction_state_check;

alter table public.student_drop_in_entitlements
  add constraint student_drop_in_entitlements_correction_state_check
    check (
      (registration_correction_required and correction_requested_at is not null)
      or (not registration_correction_required and correction_requested_at is null)
    );

alter table public.student_drop_in_requests
  add column if not exists rejection_action text;

alter table public.student_drop_in_requests
  drop constraint if exists student_drop_in_requests_rejection_action_check;

alter table public.student_drop_in_requests
  add constraint student_drop_in_requests_rejection_action_check
    check (rejection_action is null or rejection_action in ('general', 'data_correction'));

comment on column public.student_drop_in_entitlements.registration_correction_required is
  'True only when staff rejected the latest request and explicitly asked the visitor to correct registration data.';
comment on column public.student_drop_in_requests.rejection_action is
  'Staff-selected rejection behavior: general, or data_correction.';

create or replace function public.enforce_student_drop_in_registration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.student_drop_in_entitlements as entitlement
    where entitlement.student_profile_id = new.student_profile_id
      and not entitlement.registration_correction_required
      and char_length(btrim(entitlement.invoice_carrier)) between 1 and 80
      and entitlement.gender in ('male', 'female')
      and entitlement.activity_interest in ('weight_training', 'reformer_pilates')
      and char_length(btrim(entitlement.discovery_source)) between 1 and 200
      and entitlement.terms_version = '2026-08-11'
      and entitlement.terms_accepted_at is not null
  ) then
    raise exception 'DROP_IN_REGISTRATION_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace function public.save_student_drop_in_registration(
  p_student_profile_id uuid,
  p_full_name text,
  p_birth_date date,
  p_invoice_carrier text,
  p_gender text,
  p_activity_interest text,
  p_discovery_source text
)
returns setof public.student_drop_in_entitlements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement public.student_drop_in_entitlements%rowtype;
  v_now timestamptz := now();
begin
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 100 then
    raise exception 'INVALID_FULL_NAME';
  end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'INVALID_BIRTH_DATE';
  end if;
  if p_invoice_carrier is null or char_length(btrim(p_invoice_carrier)) not between 1 and 80 then
    raise exception 'INVALID_INVOICE_CARRIER';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'INVALID_GENDER';
  end if;
  if p_activity_interest not in ('weight_training', 'reformer_pilates') then
    raise exception 'INVALID_ACTIVITY_INTEREST';
  end if;
  if p_discovery_source is null or char_length(btrim(p_discovery_source)) not between 1 and 200 then
    raise exception 'INVALID_DISCOVERY_SOURCE';
  end if;

  perform 1
  from public.student_line_profiles
  where id = p_student_profile_id
    and is_active
  for update;

  if not found then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;

  insert into public.student_drop_in_entitlements (student_profile_id)
  values (p_student_profile_id)
  on conflict (student_profile_id) do nothing;

  select *
  into v_entitlement
  from public.student_drop_in_entitlements
  where student_profile_id = p_student_profile_id
  for update;

  if not v_entitlement.registration_correction_required
     and char_length(btrim(v_entitlement.invoice_carrier)) between 1 and 80
     and v_entitlement.gender in ('male', 'female')
     and v_entitlement.activity_interest in ('weight_training', 'reformer_pilates')
     and char_length(btrim(v_entitlement.discovery_source)) between 1 and 200
     and v_entitlement.terms_version = '2026-08-11'
     and v_entitlement.terms_accepted_at is not null then
    return query
      select entitlement.*
      from public.student_drop_in_entitlements as entitlement
      where entitlement.student_profile_id = p_student_profile_id;
    return;
  end if;

  update public.student_line_profiles
  set full_name = btrim(p_full_name),
      birth_date = p_birth_date,
      updated_at = v_now
  where id = p_student_profile_id;

  update public.student_drop_in_entitlements
  set invoice_carrier = btrim(p_invoice_carrier),
      gender = p_gender,
      activity_interest = p_activity_interest,
      discovery_source = btrim(p_discovery_source),
      terms_version = '2026-08-11',
      terms_accepted_at = v_now,
      registration_correction_required = false,
      correction_requested_at = null,
      updated_at = v_now
  where student_profile_id = p_student_profile_id;

  return query
    select entitlement.*
    from public.student_drop_in_entitlements as entitlement
    where entitlement.student_profile_id = p_student_profile_id;
end;
$$;

create or replace function public.decide_student_drop_in_request_v2(
  p_request_id uuid,
  p_decision text,
  p_reviewed_by uuid,
  p_rejection_action text default null
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
  if v_entitlement.registration_correction_required then
    raise exception 'DROP_IN_REGISTRATION_REQUIRED';
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

revoke all on function public.save_student_drop_in_registration(uuid, text, date, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_student_drop_in_registration(uuid, text, date, text, text, text, text)
  to service_role;

revoke all on function public.decide_student_drop_in_request_v2(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decide_student_drop_in_request_v2(uuid, text, uuid, text)
  to service_role;

revoke all on function public.enforce_student_drop_in_registration()
  from public, anon, authenticated;
grant execute on function public.enforce_student_drop_in_registration()
  to service_role;
