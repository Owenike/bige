-- Phase 6: package reservation / consumption / release + booking payment mode flow.
-- Date: 2026-03-15

alter table public.member_plan_catalog
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists price_amount numeric(12, 2) not null default 0,
  add column if not exists service_scope jsonb not null default '[]'::jsonb;

create index if not exists member_plan_catalog_tenant_branch_type_idx
  on public.member_plan_catalog(tenant_id, branch_id, plan_type, is_active, updated_at desc);

alter table public.entry_passes
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists reserved_sessions integer not null default 0,
  add column if not exists notes text,
  add constraint entry_passes_reserved_sessions_check
    check (reserved_sessions >= 0 and remaining >= 0 and reserved_sessions <= total_sessions);

create index if not exists entry_passes_tenant_status_branch_idx
  on public.entry_passes(tenant_id, branch_id, status, expires_at, updated_at desc);

alter table public.bookings
  add column if not exists booking_payment_mode text not null default 'single' check (booking_payment_mode in ('single', 'package')),
  add column if not exists entry_pass_id uuid references public.entry_passes(id) on delete set null,
  add column if not exists member_plan_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists package_sessions_reserved integer not null default 0,
  add column if not exists package_sessions_consumed integer not null default 0,
  add column if not exists final_amount numeric(12, 2) not null default 0,
  add column if not exists outstanding_amount numeric(12, 2) not null default 0,
  add column if not exists payment_reference text,
  add column if not exists payment_updated_at timestamptz;

alter table public.bookings
  add constraint bookings_package_session_counts_check
    check (package_sessions_reserved >= 0 and package_sessions_consumed >= 0);

create index if not exists bookings_tenant_payment_mode_idx
  on public.bookings(tenant_id, booking_payment_mode, starts_at desc);

create index if not exists bookings_tenant_entry_pass_idx
  on public.bookings(tenant_id, entry_pass_id, starts_at desc);

create table if not exists public.booking_package_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  entry_pass_id uuid not null references public.entry_passes(id) on delete cascade,
  member_plan_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  action text not null check (action in ('reserve', 'consume', 'release', 'adjust')),
  sessions_delta integer not null,
  reason text,
  note text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists booking_package_logs_booking_idx
  on public.booking_package_logs(tenant_id, booking_id, created_at desc);

create index if not exists booking_package_logs_entry_pass_idx
  on public.booking_package_logs(tenant_id, entry_pass_id, created_at desc);

create unique index if not exists booking_package_logs_booking_reserve_uidx
  on public.booking_package_logs(tenant_id, booking_id)
  where action = 'reserve';

create unique index if not exists booking_package_logs_booking_consume_uidx
  on public.booking_package_logs(tenant_id, booking_id)
  where action = 'consume';

create unique index if not exists booking_package_logs_booking_release_uidx
  on public.booking_package_logs(tenant_id, booking_id)
  where action = 'release';

alter table public.booking_package_logs enable row level security;

drop policy if exists booking_package_logs_tenant_access on public.booking_package_logs;
create policy booking_package_logs_tenant_access
  on public.booking_package_logs
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

create or replace function public.manage_booking_package_usage(
  p_action text,
  p_tenant_id uuid,
  p_booking_id uuid,
  p_member_id uuid,
  p_entry_pass_id uuid,
  p_actor_id uuid default null,
  p_reason text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_sessions integer default 1
)
returns table (
  log_id uuid,
  action text,
  entry_pass_id uuid,
  member_plan_contract_id uuid,
  remaining integer,
  reserved_sessions integer,
  redemption_id uuid
)
language plpgsql
set search_path = public
as $$
declare
  v_action text := lower(coalesce(p_action, ''));
  v_idempotency_key text := coalesce(nullif(trim(p_idempotency_key), ''), concat('booking-package:', p_booking_id::text, ':', v_action));
  v_sessions integer := greatest(1, coalesce(p_sessions, 1));
  v_booking public.bookings%rowtype;
  v_pass public.entry_passes%rowtype;
  v_contract public.member_plan_contracts%rowtype;
  v_existing_log public.booking_package_logs%rowtype;
  v_inserted_log public.booking_package_logs%rowtype;
  v_redemption public.session_redemptions%rowtype;
  v_next_contract_status text;
begin
  if v_action not in ('reserve', 'consume', 'release', 'adjust') then
    raise exception 'invalid_booking_package_action';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.member_id is distinct from p_member_id then
    raise exception 'booking_member_mismatch';
  end if;

  select *
  into v_existing_log
  from public.booking_package_logs
  where tenant_id = p_tenant_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if found then
    return query
    select
      v_existing_log.id,
      v_existing_log.action,
      v_existing_log.entry_pass_id,
      v_existing_log.member_plan_contract_id,
      coalesce(v_pass.remaining, 0),
      coalesce(v_pass.reserved_sessions, 0),
      null::uuid;
    return;
  end if;

  select *
  into v_pass
  from public.entry_passes
  where id = p_entry_pass_id
    and tenant_id = p_tenant_id
    and member_id = p_member_id
  for update;

  if not found then
    raise exception 'entry_pass_not_found';
  end if;

  if v_pass.member_plan_contract_id is not null then
    select *
    into v_contract
    from public.member_plan_contracts
    where id = v_pass.member_plan_contract_id
      and tenant_id = p_tenant_id
    for update;
  end if;

  if v_action = 'reserve' then
    if exists (
      select 1
      from public.booking_package_logs
      where tenant_id = p_tenant_id
        and booking_id = p_booking_id
        and action = 'reserve'
    ) then
      raise exception 'booking_package_already_reserved';
    end if;

    if coalesce(v_pass.status, 'active') <> 'active' then
      raise exception 'entry_pass_inactive';
    end if;

    if v_pass.expires_at is not null and v_pass.expires_at < now() then
      raise exception 'entry_pass_expired';
    end if;

    if coalesce(v_pass.remaining, 0) - coalesce(v_pass.reserved_sessions, 0) < v_sessions then
      raise exception 'insufficient_available_sessions';
    end if;

    update public.entry_passes
    set reserved_sessions = coalesce(reserved_sessions, 0) + v_sessions,
        updated_at = now()
    where id = v_pass.id
    returning * into v_pass;

    insert into public.booking_package_logs (
      tenant_id,
      branch_id,
      booking_id,
      member_id,
      entry_pass_id,
      member_plan_contract_id,
      action,
      sessions_delta,
      reason,
      note,
      idempotency_key,
      payload,
      created_by
    )
    values (
      p_tenant_id,
      v_booking.branch_id,
      p_booking_id,
      p_member_id,
      v_pass.id,
      v_pass.member_plan_contract_id,
      'reserve',
      v_sessions,
      coalesce(p_reason, 'booking_reserve'),
      p_note,
      v_idempotency_key,
      jsonb_build_object('bookingId', p_booking_id, 'sessions', v_sessions),
      p_actor_id
    )
    returning * into v_inserted_log;
  elsif v_action = 'release' then
    if exists (
      select 1
      from public.booking_package_logs
      where tenant_id = p_tenant_id
        and booking_id = p_booking_id
        and action = 'release'
    ) then
      raise exception 'booking_package_already_released';
    end if;

    if coalesce(v_pass.reserved_sessions, 0) < v_sessions then
      raise exception 'insufficient_reserved_sessions';
    end if;

    update public.entry_passes
    set reserved_sessions = greatest(0, coalesce(reserved_sessions, 0) - v_sessions),
        updated_at = now()
    where id = v_pass.id
    returning * into v_pass;

    insert into public.booking_package_logs (
      tenant_id,
      branch_id,
      booking_id,
      member_id,
      entry_pass_id,
      member_plan_contract_id,
      action,
      sessions_delta,
      reason,
      note,
      idempotency_key,
      payload,
      created_by
    )
    values (
      p_tenant_id,
      v_booking.branch_id,
      p_booking_id,
      p_member_id,
      v_pass.id,
      v_pass.member_plan_contract_id,
      'release',
      -v_sessions,
      coalesce(p_reason, 'booking_release'),
      p_note,
      v_idempotency_key,
      jsonb_build_object('bookingId', p_booking_id, 'sessions', v_sessions),
      p_actor_id
    )
    returning * into v_inserted_log;
  elsif v_action = 'consume' then
    if exists (
      select 1
      from public.booking_package_logs
      where tenant_id = p_tenant_id
        and booking_id = p_booking_id
        and action = 'consume'
    ) then
      raise exception 'booking_package_already_consumed';
    end if;

    if coalesce(v_pass.remaining, 0) < v_sessions then
      raise exception 'insufficient_remaining_sessions';
    end if;

    if coalesce(v_pass.reserved_sessions, 0) > 0 then
      update public.entry_passes
      set remaining = greatest(0, remaining - v_sessions),
          reserved_sessions = greatest(0, reserved_sessions - least(reserved_sessions, v_sessions)),
          status = case when greatest(0, remaining - v_sessions) <= 0 then 'expired' else status end,
          updated_at = now()
      where id = v_pass.id
      returning * into v_pass;
    else
      update public.entry_passes
      set remaining = greatest(0, remaining - v_sessions),
          status = case when greatest(0, remaining - v_sessions) <= 0 then 'expired' else status end,
          updated_at = now()
      where id = v_pass.id
      returning * into v_pass;
    end if;

    insert into public.session_redemptions (
      tenant_id,
      booking_id,
      member_id,
      redeemed_by,
      redeemed_kind,
      pass_id,
      quantity,
      note,
      member_plan_contract_id
    )
    values (
      p_tenant_id,
      p_booking_id,
      p_member_id,
      p_actor_id,
      'pass',
      v_pass.id,
      v_sessions,
      p_note,
      v_pass.member_plan_contract_id
    )
    returning * into v_redemption;

    insert into public.booking_package_logs (
      tenant_id,
      branch_id,
      booking_id,
      member_id,
      entry_pass_id,
      member_plan_contract_id,
      action,
      sessions_delta,
      reason,
      note,
      idempotency_key,
      payload,
      created_by
    )
    values (
      p_tenant_id,
      v_booking.branch_id,
      p_booking_id,
      p_member_id,
      v_pass.id,
      v_pass.member_plan_contract_id,
      'consume',
      -v_sessions,
      coalesce(p_reason, 'booking_consume'),
      p_note,
      v_idempotency_key,
      jsonb_build_object('bookingId', p_booking_id, 'sessions', v_sessions, 'redemptionId', v_redemption.id),
      p_actor_id
    )
    returning * into v_inserted_log;

    if v_contract.id is not null then
      v_next_contract_status := case
        when v_contract.ends_at is not null and v_contract.ends_at < now() then 'expired'
        when coalesce(v_pass.remaining, 0) <= 0 then 'exhausted'
        when coalesce(v_contract.status, 'active') in ('canceled', 'frozen', 'pending') then v_contract.status
        else 'active'
      end;

      update public.member_plan_contracts
      set remaining_sessions = v_pass.remaining,
          status = v_next_contract_status,
          updated_by = p_actor_id,
          updated_at = now()
      where id = v_contract.id;

      insert into public.member_plan_ledger (
        tenant_id,
        branch_id,
        member_id,
        contract_id,
        source_type,
        delta_uses,
        delta_sessions,
        balance_uses,
        balance_sessions,
        reference_type,
        reference_id,
        reason,
        payload,
        created_by
      )
      values (
        p_tenant_id,
        v_booking.branch_id,
        p_member_id,
        v_contract.id,
        'redeem',
        0,
        -v_sessions,
        null,
        v_pass.remaining,
        'booking_package_consume',
        p_booking_id::text,
        coalesce(p_reason, 'booking_consume'),
        jsonb_build_object('bookingId', p_booking_id, 'entryPassId', v_pass.id, 'redemptionId', v_redemption.id),
        p_actor_id
      );
    end if;
  else
    insert into public.booking_package_logs (
      tenant_id,
      branch_id,
      booking_id,
      member_id,
      entry_pass_id,
      member_plan_contract_id,
      action,
      sessions_delta,
      reason,
      note,
      idempotency_key,
      payload,
      created_by
    )
    values (
      p_tenant_id,
      v_booking.branch_id,
      p_booking_id,
      p_member_id,
      v_pass.id,
      v_pass.member_plan_contract_id,
      'adjust',
      0,
      coalesce(p_reason, 'booking_adjust'),
      p_note,
      v_idempotency_key,
      jsonb_build_object('bookingId', p_booking_id),
      p_actor_id
    )
    returning * into v_inserted_log;
  end if;

  return query
  select
    v_inserted_log.id,
    v_inserted_log.action,
    v_pass.id,
    v_pass.member_plan_contract_id,
    coalesce(v_pass.remaining, 0),
    coalesce(v_pass.reserved_sessions, 0),
    v_redemption.id;
end;
$$;
