begin;

create or replace function public.bige_complete_trial_outcome(
  p_booking_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  booking_row public.bookings%rowtype;
  can_manage boolean := false;
  window_exempt boolean := false;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found then
    raise exception 'forbidden';
  end if;

  if p_outcome not in ('pending_conversion', 'not_converted') then
    raise exception 'invalid_trial_conversion_outcome';
  end if;

  select * into booking_row
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
    and operation_kind = 'trial'
  for update;

  if not found then
    raise exception 'trial_booking_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from booking_row.tenant_id then
    raise exception 'forbidden';
  end if;

  can_manage :=
    actor.role = 'platform_admin'
    or upper(coalesce(actor.employee_number, '')) in ('E000001', 'E000006')
    or (
      actor.department = 'coaching'
      and actor.position in (
        'coach_team_lead',
        'coach_director',
        'coach_assistant_manager',
        'coach_manager',
        'coach_city_manager'
      )
    )
    or (
      actor.department is null
      and actor.position is null
      and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
    )
    or (
      actor.role = 'coach'
      and actor.id = booking_row.coach_id
    );

  if not can_manage then
    raise exception 'forbidden';
  end if;

  if booking_row.converted_at is not null then
    raise exception 'trial_already_converted';
  end if;

  if booking_row.status not in ('pending', 'confirmed', 'booked', 'checked_in', 'completed') then
    raise exception 'booking_not_active';
  end if;

  window_exempt :=
    actor.role in ('platform_admin', 'manager', 'branch_manager', 'store_owner', 'store_manager')
    or actor.position in (
      'general_affairs_assistant_manager',
      'general_affairs_manager',
      'coach_assistant_manager',
      'coach_manager',
      'coach_city_manager'
    );

  if not window_exempt
     and (
       now() < booking_row.starts_at - interval '30 minutes'
       or now() > booking_row.ends_at + interval '30 minutes'
     ) then
    raise exception 'outside_completion_window';
  end if;

  update public.bookings
  set status = 'completed',
      operation_result = 'completed',
      trial_conversion_outcome = p_outcome,
      completed_at = coalesce(completed_at, now()),
      status_updated_at = now(),
      updated_at = now()
  where id = booking_row.id
  returning * into booking_row;

  if p_outcome = 'not_converted' then
    update public.crm_leads
    set status = 'lost',
        trial_status = 'attended',
        trial_result = 'lost',
        lost_reason = 'fa_not_converted',
        updated_by = actor.id,
        updated_at = now()
    where tenant_id = booking_row.tenant_id
      and trial_booking_id = booking_row.trial_booking_id;
  else
    update public.crm_leads
    set status = 'trial_completed',
        trial_status = 'attended',
        trial_result = null,
        lost_reason = null,
        updated_by = actor.id,
        updated_at = now()
    where tenant_id = booking_row.tenant_id
      and trial_booking_id = booking_row.trial_booking_id
      and status <> 'won';
  end if;

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
    'bige_trial_outcome_recorded',
    'booking',
    booking_row.id::text,
    p_outcome,
    jsonb_build_object(
      'outcome', p_outcome,
      'trialBookingId', booking_row.trial_booking_id,
      'memberId', booking_row.member_id
    )
  );

  return jsonb_build_object(
    'id', booking_row.id,
    'status', booking_row.status,
    'operationResult', booking_row.operation_result,
    'trialConversionOutcome', booking_row.trial_conversion_outcome
  );
end;
$$;

revoke all on function public.bige_complete_trial_outcome(uuid, text) from public, anon;
grant execute on function public.bige_complete_trial_outcome(uuid, text) to authenticated;

drop policy if exists bige_daily_closures_tenant_access on public.bige_daily_closures;
create policy bige_daily_closures_tenant_access
  on public.bige_daily_closures for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = bige_daily_closures.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = bige_daily_closures.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

drop policy if exists bige_daily_closure_history_tenant_access on public.bige_daily_closure_history;
drop policy if exists bige_daily_closure_history_tenant_read on public.bige_daily_closure_history;
drop policy if exists bige_daily_closure_history_tenant_insert on public.bige_daily_closure_history;

create policy bige_daily_closure_history_tenant_read
  on public.bige_daily_closure_history for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = bige_daily_closure_history.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

create policy bige_daily_closure_history_tenant_insert
  on public.bige_daily_closure_history for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = bige_daily_closure_history.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

drop policy if exists member_plan_catalog_tenant_access on public.member_plan_catalog;
drop policy if exists member_plan_catalog_tenant_read on public.member_plan_catalog;
drop policy if exists member_plan_catalog_manager_write on public.member_plan_catalog;

create policy member_plan_catalog_tenant_read
  on public.member_plan_catalog for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy member_plan_catalog_manager_write
  on public.member_plan_catalog for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = member_plan_catalog.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.is_active = true
        and actor.tenant_id = member_plan_catalog.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

create or replace function public.enforce_member_personal_data_update_permissions()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
begin
  if new.full_name is not distinct from old.full_name
     and new.phone is not distinct from old.phone
     and new.phone_normalized is not distinct from old.phone_normalized
     and new.email is not distinct from old.email
     and new.email_unavailable is not distinct from old.email_unavailable
     and new.birth_date is not distinct from old.birth_date then
    return new;
  end if;

  if auth.uid() is null and current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if old.auth_user_id = auth.uid() then
    return new;
  end if;

  if old.is_prospect = true
     and new.is_prospect = false
     and old.member_code is null
     and new.member_code is not null then
    return new;
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    raise exception 'member_personal_data_manager_required';
  end if;

  if actor.role = 'platform_admin' then
    return new;
  end if;

  if actor.department = 'coaching'
     and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager') then
    return new;
  end if;

  if actor.department is null
     and actor.position is null
     and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager') then
    return new;
  end if;

  raise exception 'member_personal_data_manager_required';
end;
$$;

drop trigger if exists enforce_member_personal_data_update_permissions on public.members;
create trigger enforce_member_personal_data_update_permissions
before update on public.members
for each row
execute function public.enforce_member_personal_data_update_permissions();

revoke all on function public.enforce_member_personal_data_update_permissions() from public, anon, authenticated;

commit;
