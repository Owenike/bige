-- Keep the no-PIN completion RPC self-contained. The legacy PIN RPC still
-- enforces the 30-minute window, so delegating to it would re-apply the limit
-- after the application has already authorized a manager or assistant manager.
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
  booking_row public.bookings%rowtype;
  member_row public.members%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  redemption_row public.session_redemptions%rowtype;
  allocation_limit integer;
  allocation_used integer;
  next_course_used jsonb;
  local_business_date date;
  status_window_exempt boolean := false;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found or actor.role not in (
    'platform_admin', 'manager', 'supervisor', 'branch_manager',
    'store_owner', 'store_manager', 'frontdesk', 'coach'
  ) then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if actor.role = 'coach'
     and booking_row.coach_id is distinct from actor.id then
    raise exception 'coach_booking_scope_denied';
  end if;

  if booking_row.operation_kind <> 'pt' then
    raise exception 'pt_booking_required';
  end if;

  if booking_row.status = 'completed' then
    select * into redemption_row
    from public.session_redemptions
    where booking_id = booking_row.id
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'bookingId', booking_row.id,
      'contractId', redemption_row.member_plan_contract_id,
      'completed', true,
      'replayed', true
    );
  end if;

  if booking_row.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
    raise exception 'booking_not_active';
  end if;

  status_window_exempt :=
    actor.role in (
      'platform_admin', 'manager', 'branch_manager',
      'store_owner', 'store_manager'
    )
    or coalesce(actor.position::text, '') in (
      'general_affairs_assistant_manager',
      'general_affairs_manager',
      'coach_assistant_manager',
      'coach_manager',
      'coach_city_manager'
    );

  if not status_window_exempt
     and (
       now() < booking_row.starts_at - interval '30 minutes'
       or now() > booking_row.ends_at + interval '30 minutes'
     ) then
    raise exception 'outside_completion_window';
  end if;

  select * into member_row
  from public.members
  where id = booking_row.member_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  if booking_row.member_plan_contract_id is not null then
    select * into contract_row
    from public.member_plan_contracts
    where id = booking_row.member_plan_contract_id
      and public.bige_member_can_use_contract(
        id,
        booking_row.member_id,
        booking_row.tenant_id
      )
    for update;
  else
    select * into contract_row
    from public.member_plan_contracts c
    where c.tenant_id = booking_row.tenant_id
      and public.bige_member_can_use_contract(
        c.id,
        booking_row.member_id,
        booking_row.tenant_id
      )
      and c.status in ('active', 'expired')
      and c.unlocked_sessions > c.used_sessions
      and coalesce((c.course_allocations->>booking_row.course_type)::integer, 0)
          > coalesce((c.course_used->>booking_row.course_type)::integer, 0)
    order by c.ends_at asc nulls last, c.created_at
    limit 1
    for update;
  end if;

  if not found then
    raise exception 'eligible_contract_not_found';
  end if;

  if not (
    contract_row.is_legacy_import
    and contract_row.signed_on is null
    and contract_row.ends_at is null
  ) and (
    contract_row.ends_at is null
    or contract_row.ends_at <= now()
  ) then
    raise exception 'contract_extension_required';
  end if;

  if contract_row.status <> 'active'
     or contract_row.unlocked_sessions <= contract_row.used_sessions
     or coalesce(contract_row.remaining_sessions, 0) <= 0 then
    raise exception 'unlocked_sessions_exhausted';
  end if;

  allocation_limit := coalesce(
    (contract_row.course_allocations->>booking_row.course_type)::integer,
    0
  );
  allocation_used := coalesce(
    (contract_row.course_used->>booking_row.course_type)::integer,
    0
  );
  if allocation_used >= allocation_limit then
    raise exception 'course_allocation_exhausted';
  end if;

  next_course_used := jsonb_set(
    coalesce(contract_row.course_used, '{}'::jsonb),
    array[booking_row.course_type],
    to_jsonb(allocation_used + 1),
    true
  );

  update public.member_plan_contracts
  set used_sessions = used_sessions + 1,
      remaining_sessions = greatest(unlocked_sessions - (used_sessions + 1), 0),
      course_used = next_course_used,
      status = case
        when used_sessions + 1 >= total_sessions then 'exhausted'
        when unlocked_sessions <= used_sessions + 1 then 'pending'
        else 'active'
      end,
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id
  returning * into contract_row;

  insert into public.session_redemptions (
    tenant_id,
    booking_id,
    member_id,
    member_plan_contract_id,
    redeemed_by,
    redeemed_kind,
    quantity,
    note,
    session_no
  ) values (
    booking_row.tenant_id,
    booking_row.id,
    booking_row.member_id,
    contract_row.id,
    actor.id,
    'pass',
    1,
    'BIG E operator-confirmed session',
    contract_row.used_sessions
  )
  returning * into redemption_row;

  insert into public.member_plan_ledger (
    tenant_id,
    branch_id,
    member_id,
    contract_id,
    source_type,
    delta_sessions,
    balance_sessions,
    reference_type,
    reference_id,
    reason,
    payload,
    created_by
  ) values (
    contract_row.tenant_id,
    contract_row.branch_id,
    contract_row.member_id,
    contract_row.id,
    'redeem',
    -1,
    contract_row.remaining_sessions,
    'booking',
    booking_row.id::text,
    'operator_confirmed',
    jsonb_build_object(
      'courseType', booking_row.course_type,
      'coachId', booking_row.coach_id
    ),
    actor.id
  );

  update public.bookings
  set status = 'completed',
      operation_result = 'completed',
      completed_at = now(),
      cancelled_at = null,
      status_updated_at = now(),
      status_reason = 'operator_confirmed',
      member_plan_contract_id = contract_row.id,
      package_sessions_reserved = 0,
      package_sessions_consumed = greatest(package_sessions_consumed, 1),
      updated_at = now()
  where id = booking_row.id;

  local_business_date := (booking_row.starts_at at time zone 'Asia/Taipei')::date;
  update public.bige_daily_closures
  set status = 'reopened',
      revision = revision + 1,
      reopened_by = actor.id,
      reopened_at = now(),
      reopen_reason = 'booking_completed_after_confirmation',
      confirmed_by = null,
      confirmed_at = null,
      updated_at = now()
  where tenant_id = booking_row.tenant_id
    and business_date = local_business_date
    and status = 'confirmed'
    and (branch_id is not distinct from booking_row.branch_id);

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  ) values (
    booking_row.tenant_id,
    actor.id,
    'fitness_session_completed',
    'booking',
    booking_row.id::text,
    'operator_confirmed',
    jsonb_build_object(
      'contractId', contract_row.id,
      'memberId', booking_row.member_id,
      'courseType', booking_row.course_type,
      'redemptionId', redemption_row.id
    )
  );

  return jsonb_build_object(
    'bookingId', booking_row.id,
    'contractId', contract_row.id,
    'redemptionId', redemption_row.id,
    'memberId', member_row.id,
    'memberName', member_row.full_name,
    'memberEmail', member_row.email,
    'emailUnavailable', member_row.email_unavailable,
    'courseType', booking_row.course_type,
    'startsAt', booking_row.starts_at,
    'coachId', booking_row.coach_id,
    'completed', true,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_complete_schedule_booking_without_pin(uuid)
  from public, anon;
grant execute on function public.bige_complete_schedule_booking_without_pin(uuid)
  to authenticated;

commit;
