begin;

-- One original FA may have only one active BB at a time and may be converted by
-- BB only once. Cancelled, no-show, and completed/no-sale visits remain eligible
-- for a later BB appointment.
create unique index if not exists bookings_bb_one_active_per_fa_idx
  on public.bookings(tenant_id, trial_booking_id)
  where operation_kind = 'bb'
    and status in ('pending', 'confirmed', 'booked', 'checked_in');

create unique index if not exists bookings_bb_one_conversion_per_fa_idx
  on public.bookings(tenant_id, trial_booking_id)
  where operation_kind = 'bb'
    and converted_at is not null;

create or replace function public.bige_enforce_bb_source_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.operation_kind <> 'bb' or new.trial_booking_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.tenant_id::text || ':bb-source:' || new.trial_booking_id::text,
      0
    )
  );

  if new.status in ('pending', 'confirmed', 'booked', 'checked_in') then
    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.trial_booking_id = new.trial_booking_id
        and booking.operation_kind = 'bb'
        and booking.id <> new.id
        and booking.converted_at is not null
    ) then
      raise exception 'bb_source_already_converted';
    end if;

    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.trial_booking_id = new.trial_booking_id
        and booking.operation_kind = 'bb'
        and booking.id <> new.id
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
    ) then
      raise exception 'bb_active_followup_exists';
    end if;
  end if;

  if new.converted_at is not null and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = new.tenant_id
      and booking.trial_booking_id = new.trial_booking_id
      and booking.operation_kind = 'bb'
      and booking.id <> new.id
      and booking.converted_at is not null
  ) then
    raise exception 'bb_source_already_converted';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_bige_bb_source_lifecycle on public.bookings;
create trigger bookings_bige_bb_source_lifecycle
before insert or update of tenant_id, trial_booking_id, operation_kind, status,
  converted_at
on public.bookings
for each row
execute function public.bige_enforce_bb_source_lifecycle();

revoke all on function public.bige_enforce_bb_source_lifecycle()
  from public, anon, authenticated;

-- Keep BB create/result permissions aligned with the schedule permission rule
-- already used by the API and the other schedule RPCs.
do $migration$
declare
  function_definition text;
  patched_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.bige_create_bb_schedule_booking_v1(uuid,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text,text)'::regprocedure
  );
  patched_definition := replace(
    function_definition,
    E'  if not found or actor.role not in (''platform_admin'', ''manager'', ''store_owner'', ''store_manager'', ''frontdesk'') then\n    raise exception ''forbidden'';\n  end if;',
    E'  if not found or not public.bige_profile_can_manage_schedule(actor) then\n    raise exception ''forbidden'';\n  end if;'
  );
  if patched_definition = function_definition then
    raise exception 'bige_create_bb_schedule_booking_v1 permission block not found';
  end if;
  execute patched_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  patched_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.bige_complete_bb_outcome_v1(uuid,text)'::regprocedure
  );
  patched_definition := replace(
    function_definition,
    E'  if not found or actor.role not in (''platform_admin'', ''manager'', ''store_owner'', ''store_manager'', ''frontdesk'') then\n    raise exception ''forbidden'';\n  end if;',
    E'  if not found or not public.bige_profile_can_manage_schedule(actor) then\n    raise exception ''forbidden'';\n  end if;'
  );
  if patched_definition = function_definition then
    raise exception 'bige_complete_bb_outcome_v1 permission block not found';
  end if;
  execute patched_definition;
end;
$migration$;

-- Enforce the same 30-minute result window in the database. Managers and
-- assistant managers retain the established anytime correction exemption.
create or replace function public.bige_profile_status_window_exempt(
  p_actor public.profiles
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    p_actor.role in (
      'platform_admin', 'manager', 'branch_manager', 'store_owner', 'store_manager'
    )
    or coalesce(p_actor.position::text, '') in (
      'general_affairs_assistant_manager',
      'general_affairs_manager',
      'coach_assistant_manager',
      'coach_manager',
      'coach_city_manager'
    );
$$;

revoke all on function public.bige_profile_status_window_exempt(public.profiles)
  from public, anon;
grant execute on function public.bige_profile_status_window_exempt(public.profiles)
  to authenticated, service_role;

create or replace function public.bige_enforce_bb_completion_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
begin
  if new.operation_kind <> 'bb'
     or old.status not in ('pending', 'confirmed', 'booked', 'checked_in')
     or new.status <> 'completed' then
    return new;
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found then
    raise exception 'forbidden';
  end if;
  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from new.tenant_id then
    raise exception 'forbidden';
  end if;
  if not public.bige_profile_status_window_exempt(actor)
     and (
       now() < new.starts_at - interval '30 minutes'
       or now() > new.ends_at + interval '30 minutes'
     ) then
    raise exception 'outside_completion_window';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_bige_bb_completion_window on public.bookings;
create trigger bookings_bige_bb_completion_window
before update of status, operation_result, bb_conversion_outcome, converted_at
on public.bookings
for each row
execute function public.bige_enforce_bb_completion_window();

revoke all on function public.bige_enforce_bb_completion_window()
  from public, anon, authenticated;

-- Correct an accidentally recorded no-sale without deleting the appointment.
create or replace function public.bige_restore_bb_no_sale_v1(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;
  if not found or not public.bige_profile_can_manage_schedule(actor) then
    raise exception 'forbidden';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
    and operation_kind = 'bb'
  for update;
  if not found then raise exception 'bb_booking_not_found'; end if;
  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;
  if booking_row.converted_at is not null then
    raise exception 'bb_already_converted';
  end if;
  if booking_row.status <> 'completed'
     or booking_row.bb_conversion_outcome <> 'not_converted' then
    raise exception 'bb_no_sale_not_found';
  end if;

  update public.bookings
  set status = 'booked',
      operation_result = null,
      bb_conversion_outcome = null,
      completed_at = null,
      status_reason = 'bb_no_sale_restored',
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id
  returning * into booking_row;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id, actor.id, 'bige_bb_no_sale_restored', 'booking',
    booking_row.id::text, 'manager_correction',
    jsonb_build_object('trialBookingId', booking_row.trial_booking_id)
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', booking_row.status,
    'operationResult', booking_row.operation_result,
    'bbConversionOutcome', booking_row.bb_conversion_outcome
  );
end;
$$;

revoke all on function public.bige_restore_bb_no_sale_v1(uuid)
  from public, anon;
grant execute on function public.bige_restore_bb_no_sale_v1(uuid)
  to authenticated;

-- A BB conversion may be restored only after every payment was reversed and
-- no course, redemption, or extension depends on the contract.
create or replace function public.bige_restore_bb_conversion_v1(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  contract_row public.member_plan_contracts%rowtype;
  dependency_count integer := 0;
  member_reverted_to_prospect boolean := false;
  creation_audit_payload jsonb := '{}'::jsonb;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;
  if not found then raise exception 'forbidden'; end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
    and operation_kind = 'bb'
  for update;
  if not found then raise exception 'bb_booking_not_found'; end if;
  if actor.role <> 'platform_admin'
     and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;
  if not (
    actor.role = 'platform_admin'
    or upper(coalesce(actor.employee_number, '')) = 'E000001'
    or (
      actor.department = 'coaching'
      and actor.position in ('coach_manager', 'coach_city_manager')
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
    )
  ) then
    raise exception 'manager_required';
  end if;
  if booking_row.converted_at is null
     or booking_row.converted_contract_id is null
     or booking_row.bb_conversion_outcome <> 'converted' then
    raise exception 'bb_conversion_not_found';
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = booking_row.converted_contract_id
    and tenant_id = booking_row.tenant_id
    and converted_from_booking_id = booking_row.id
    and sales_origin_kind = 'bb'
  for update;
  if not found or contract_row.status = 'canceled' then
    raise exception 'bb_conversion_restore_not_available';
  end if;
  if contract_row.used_sessions <> 0
     or contract_row.unlocked_sessions <> 0 then
    raise exception 'bb_conversion_has_available_or_used_sessions';
  end if;
  if exists (
    select 1 from public.bige_contract_payments payment
    where payment.tenant_id = booking_row.tenant_id
      and payment.contract_id = contract_row.id
      and payment.status = 'recorded'
  ) then
    raise exception 'bb_conversion_payments_must_be_reversed';
  end if;

  select count(*) into dependency_count
  from public.bookings dependent
  where dependent.tenant_id = booking_row.tenant_id
    and dependent.member_plan_contract_id = contract_row.id;
  if dependency_count > 0 then raise exception 'bb_conversion_has_linked_bookings'; end if;

  select count(*) into dependency_count
  from public.session_redemptions redemption
  where redemption.tenant_id = booking_row.tenant_id
    and redemption.member_plan_contract_id = contract_row.id;
  if dependency_count > 0 then raise exception 'bb_conversion_has_redemptions'; end if;

  select count(*) into dependency_count
  from public.bige_contract_extensions extension
  where extension.tenant_id = booking_row.tenant_id
    and extension.contract_id = contract_row.id;
  if dependency_count > 0 then raise exception 'bb_conversion_has_extensions'; end if;

  select coalesce(audit.payload, '{}'::jsonb)
  into creation_audit_payload
  from public.audit_logs audit
  where audit.tenant_id = booking_row.tenant_id
    and audit.action = 'direct_member_contract_created'
    and audit.target_type = 'member_plan_contract'
    and audit.target_id = contract_row.id::text
  order by audit.created_at desc
  limit 1;

  update public.member_plan_contracts
  set status = 'canceled',
      payment_status = case
        when exists (
          select 1 from public.bige_contract_payments payment
          where payment.contract_id = contract_row.id
            and payment.status = 'refunded'
        ) then 'refunded'
        else 'unpaid'
      end,
      unlocked_sessions = 0,
      remaining_sessions = 0,
      note = concat_ws(
        '；',
        nullif(btrim(coalesce(note, '')), ''),
        'BB 成交已復原 ' || to_char(now() at time zone 'Asia/Taipei', 'YYYY-MM-DD HH24:MI')
      ),
      updated_by = actor.id,
      updated_at = now()
  where id = contract_row.id;

  update public.bookings
  set status = 'completed',
      operation_result = 'completed',
      bb_conversion_outcome = 'not_converted',
      converted_at = null,
      converted_contract_id = null,
      status_reason = 'bb_conversion_restored',
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id;

  if coalesce((creation_audit_payload->>'memberWasProspectBeforeConversion')::boolean, false)
     and creation_audit_payload->>'memberCodeBeforeConversion' is null
     and exists (
       select 1 from public.members member
       where member.id = contract_row.member_id
         and member.tenant_id = booking_row.tenant_id
         and member.auth_user_id is null
         and member.portal_activated_at is null
     )
     and not exists (
       select 1 from public.member_plan_contracts other_contract
       where other_contract.tenant_id = booking_row.tenant_id
         and other_contract.member_id = contract_row.member_id
         and other_contract.id <> contract_row.id
         and other_contract.status <> 'canceled'
     )
     and not exists (
       select 1 from public.member_plan_contract_members shared_member
       join public.member_plan_contracts shared_contract
         on shared_contract.id = shared_member.contract_id
        and shared_contract.tenant_id = shared_member.tenant_id
       where shared_member.tenant_id = booking_row.tenant_id
         and shared_member.member_id = contract_row.member_id
         and shared_member.contract_id <> contract_row.id
         and shared_contract.status <> 'canceled'
     )
     and not exists (
       select 1 from public.bookings other_booking
       where other_booking.tenant_id = booking_row.tenant_id
         and other_booking.member_id = contract_row.member_id
         and other_booking.id <> booking_row.id
         and other_booking.operation_kind = 'pt'
         and other_booking.status <> 'cancelled'
     )
     and not exists (
       select 1 from public.session_redemptions redemption
       where redemption.tenant_id = booking_row.tenant_id
         and redemption.member_id = contract_row.member_id
     )
     and not exists (
       select 1 from public.entry_passes pass
       where pass.tenant_id = booking_row.tenant_id
         and pass.member_id = contract_row.member_id
     )
     and not exists (
       select 1 from public.subscriptions subscription
       where subscription.tenant_id = booking_row.tenant_id
         and subscription.member_id = contract_row.member_id
     )
  then
    update public.members
    set member_code = null,
        is_prospect = true,
        attendance_pin_hash = null,
        attendance_pin_set_at = null,
        attendance_pin_reset_required = false,
        updated_at = now()
    where id = contract_row.member_id
      and tenant_id = booking_row.tenant_id;
    member_reverted_to_prospect := found;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    booking_row.tenant_id, actor.id, 'bige_bb_conversion_restored', 'booking',
    booking_row.id::text, 'manager_correction',
    jsonb_build_object(
      'contractId', contract_row.id,
      'trialBookingId', booking_row.trial_booking_id,
      'memberRevertedToProspect', member_reverted_to_prospect
    )
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', 'completed',
    'operationResult', 'completed',
    'bbConversionOutcome', 'not_converted',
    'convertedAt', null,
    'convertedContractId', null,
    'memberRevertedToProspect', member_reverted_to_prospect
  );
end;
$$;

revoke all on function public.bige_restore_bb_conversion_v1(uuid)
  from public, anon;
grant execute on function public.bige_restore_bb_conversion_v1(uuid)
  to authenticated;

commit;
