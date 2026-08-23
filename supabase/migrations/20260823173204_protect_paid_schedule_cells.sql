begin;

-- A paid schedule cell is financial data. Keep this narrower than the normal
-- schedule-management rule: platform admins, coaching assistant managers,
-- coaching managers/city managers, and their legacy equivalents only.
create or replace function public.bige_profile_can_manage_paid_schedule_cells(
  p_actor public.profiles
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    coalesce(p_actor.is_active, false) = true
    and (
      p_actor.role = 'platform_admin'
      or (
        p_actor.department = 'coaching'
        and p_actor.position in (
          'coach_assistant_manager',
          'coach_manager',
          'coach_city_manager'
        )
      )
      or (
        p_actor.department is null
        and p_actor.position is null
        and p_actor.role in (
          'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
        )
      )
    );
$$;

revoke all on function public.bige_profile_can_manage_paid_schedule_cells(public.profiles)
  from public, anon, authenticated;

create or replace function public.enforce_bige_paid_schedule_payment_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  related_booking_id uuid;
  batch_prefix text;
  has_related_payment boolean := false;
  same_initial_batch boolean := false;
  is_initial_source_attach boolean := false;
begin
  -- Server-side maintenance uses the service role and is not a staff action.
  if (select auth.role()) is null or (select auth.role()) = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active = true;

  if found and public.bige_profile_can_manage_paid_schedule_cells(actor) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'recorded' or new.source_booking_id is null then
      return new;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('bige-paid-schedule:' || new.source_booking_id::text, 0)
    );
    related_booking_id := new.source_booking_id;
    batch_prefix := regexp_replace(coalesce(new.idempotency_key, ''), ':[0-9]+$', '');

    select exists (
      select 1
      from public.bige_contract_payments payment
      where payment.status = 'recorded'
        and (
          payment.source_booking_id = related_booking_id
          or (
            payment.source_booking_id is null
            and payment.contract_id = new.contract_id
            and exists (
              select 1
              from public.bookings booking
              where booking.id = related_booking_id
                and booking.converted_contract_id = new.contract_id
            )
          )
        )
    ) into has_related_payment;

    if not has_related_payment then
      return new;
    end if;

    select
      batch_prefix <> ''
      and bool_and(
        regexp_replace(coalesce(payment.idempotency_key, ''), ':[0-9]+$', '') = batch_prefix
        and payment.recorded_by is not distinct from actor.id
      )
    into same_initial_batch
    from public.bige_contract_payments payment
    where payment.status = 'recorded'
      and (
        payment.source_booking_id = related_booking_id
        or (
          payment.source_booking_id is null
          and payment.contract_id = new.contract_id
          and exists (
            select 1
            from public.bookings booking
            where booking.id = related_booking_id
              and booking.converted_contract_id = new.contract_id
          )
        )
      );

    if coalesce(same_initial_batch, false) then
      return new;
    end if;

    raise exception 'paid_schedule_booking_manager_required';
  end if;

  if tg_op = 'UPDATE' then
    if old.amount is not distinct from new.amount
       and old.status is not distinct from new.status
       and old.source_booking_id is not distinct from new.source_booking_id then
      return new;
    end if;

    related_booking_id := coalesce(new.source_booking_id, old.source_booking_id);
    if related_booking_id is null then
      select booking.id into related_booking_id
      from public.bookings booking
      where booking.converted_contract_id = new.contract_id
      order by booking.created_at
      limit 1;
    end if;
    if related_booking_id is null then
      return new;
    end if;

    if new.source_booking_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('bige-paid-schedule:' || new.source_booking_id::text, 0)
      );
    end if;

    is_initial_source_attach :=
      old.source_booking_id is null
      and new.source_booking_id is not null
      and old.status = 'recorded'
      and new.status = 'recorded'
      and not exists (
        select 1
        from public.bige_contract_payments payment
        where payment.id <> old.id
          and payment.status = 'recorded'
          and (
            payment.source_booking_id = new.source_booking_id
            or (
              payment.source_booking_id is null
              and payment.contract_id = new.contract_id
              and exists (
                select 1
                from public.bookings booking
                where booking.id = new.source_booking_id
                  and booking.converted_contract_id = new.contract_id
              )
            )
          )
      );

    if is_initial_source_attach then
      return new;
    end if;

    raise exception 'paid_schedule_booking_manager_required';
  end if;

  related_booking_id := old.source_booking_id;
  if related_booking_id is null then
    select booking.id into related_booking_id
    from public.bookings booking
    where booking.converted_contract_id = old.contract_id
    order by booking.created_at
    limit 1;
  end if;
  if related_booking_id is not null then
    raise exception 'paid_schedule_booking_manager_required';
  end if;
  return old;
end;
$$;

revoke all on function public.enforce_bige_paid_schedule_payment_access()
  from public, anon, authenticated;

drop trigger if exists enforce_bige_paid_schedule_payment_update
  on public.bige_contract_payments;
create trigger enforce_bige_paid_schedule_payment_update
before update of amount, status, source_booking_id
on public.bige_contract_payments
for each row execute function public.enforce_bige_paid_schedule_payment_access();

drop trigger if exists enforce_bige_paid_schedule_payment_insert
  on public.bige_contract_payments;
create trigger enforce_bige_paid_schedule_payment_insert
before insert
on public.bige_contract_payments
for each row execute function public.enforce_bige_paid_schedule_payment_access();

drop trigger if exists enforce_bige_paid_schedule_payment_delete
  on public.bige_contract_payments;
create trigger enforce_bige_paid_schedule_payment_delete
before delete
on public.bige_contract_payments
for each row execute function public.enforce_bige_paid_schedule_payment_access();

create or replace function public.enforce_bige_paid_schedule_booking_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  has_recorded_payment boolean := false;
begin
  if old.status is not distinct from new.status
     or new.status <> 'cancelled'
     or new.status_reason not in ('schedule_trash_deleted', 'schedule_drag_overwrite') then
    return new;
  end if;

  select exists (
    select 1
    from public.bige_contract_payments payment
    where payment.tenant_id = old.tenant_id
      and payment.status = 'recorded'
      and (
        payment.source_booking_id = old.id
        or (
          old.converted_contract_id is not null
          and payment.contract_id = old.converted_contract_id
          and payment.source_booking_id is null
        )
      )
  ) into has_recorded_payment;

  if not has_recorded_payment
     or (select auth.role()) is null
     or (select auth.role()) = 'service_role' then
    return new;
  end if;

  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active = true;

  if not found or not public.bige_profile_can_manage_paid_schedule_cells(actor) then
    raise exception 'paid_schedule_booking_manager_required';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_bige_paid_schedule_booking_access()
  from public, anon, authenticated;

drop trigger if exists enforce_bige_paid_schedule_booking_update
  on public.bookings;
create trigger enforce_bige_paid_schedule_booking_update
before update of status, status_reason
on public.bookings
for each row execute function public.enforce_bige_paid_schedule_booking_access();

commit;
