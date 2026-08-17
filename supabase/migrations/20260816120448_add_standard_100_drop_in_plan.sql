-- Add a data-driven NT$100 admission plan for visitors who do not provide a
-- five-star review. The existing NT$50 / ten-use plan remains the default.

alter table public.student_drop_in_entitlements
  add column if not exists entry_plan text not null default 'review_50';

alter table public.student_drop_in_entitlements
  drop constraint if exists student_drop_in_entitlements_entry_plan_check,
  drop constraint if exists student_drop_in_entitlements_used_uses_check;

alter table public.student_drop_in_entitlements
  add constraint student_drop_in_entitlements_entry_plan_check
    check (entry_plan in ('review_50', 'standard_100')),
  add constraint student_drop_in_entitlements_used_uses_check
    check (
      used_uses >= 0
      and (entry_plan = 'standard_100' or used_uses <= total_uses)
    );

comment on column public.student_drop_in_entitlements.entry_plan is
  'review_50 requires five-star proof and allows ten NT$50 entries; standard_100 needs no review proof and has no business use limit.';

alter table public.student_drop_ins
  add column if not exists entry_plan text not null default 'review_50';

alter table public.student_drop_ins
  alter column review_photo_path drop not null,
  alter column remaining_uses drop not null;

alter table public.student_drop_ins
  drop constraint if exists student_drop_ins_entry_plan_check,
  drop constraint if exists student_drop_ins_use_sequence_check,
  drop constraint if exists student_drop_ins_remaining_uses_check,
  drop constraint if exists student_drop_ins_price_twd_check,
  drop constraint if exists student_drop_ins_plan_snapshot_check;

alter table public.student_drop_ins
  add constraint student_drop_ins_entry_plan_check
    check (entry_plan in ('review_50', 'standard_100')),
  add constraint student_drop_ins_use_sequence_check
    check (use_sequence >= 1),
  add constraint student_drop_ins_remaining_uses_check
    check (remaining_uses is null or remaining_uses between 0 and 9),
  add constraint student_drop_ins_price_twd_check
    check (price_twd in (50, 100)),
  add constraint student_drop_ins_plan_snapshot_check
    check (
      (
        entry_plan = 'review_50'
        and price_twd = 50
        and review_photo_path is not null
        and remaining_uses is not null
        and use_sequence <= 10
      )
      or (
        entry_plan = 'standard_100'
        and price_twd = 100
        and remaining_uses is null
      )
    );

comment on column public.student_drop_ins.entry_plan is
  'Immutable admission-plan snapshot used for price, evidence, and usage-history display.';

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
    case when v_entitlement.entry_plan = 'standard_100' then 100 else 50 end,
    v_entitlement.entry_plan,
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

revoke all on function public.decide_student_drop_in_request_v2(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.decide_student_drop_in_request_v2(uuid, text, uuid, text)
  to service_role;
