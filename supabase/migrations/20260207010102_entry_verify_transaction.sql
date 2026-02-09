create or replace function public.verify_entry_scan(
  p_tenant_id uuid,
  p_store_id uuid,
  p_member_id uuid,
  p_jti text,
  p_checked_at timestamptz default now(),
  p_anti_passback_minutes integer default 10
)
returns table (
  decision text,
  reason text,
  checked_at timestamptz,
  membership_kind text,
  monthly_expires_at timestamptz,
  remaining_sessions integer,
  latest_allow_at timestamptz,
  today_allow_count bigint
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_checked_at, now());
  v_latest_allow_at timestamptz;
  v_today_allow_count bigint := 0;
  v_subscription public.subscriptions%rowtype;
  v_selected_pass public.entry_passes%rowtype;
  v_remaining_sessions integer := 0;
  v_membership_kind text := 'none';
  v_reason text := null;
begin
  if p_tenant_id is null or p_store_id is null or p_member_id is null or p_jti is null or btrim(p_jti) = '' then
    raise exception 'invalid_verify_input';
  end if;

  begin
    insert into public.qr_token_uses (jti, tenant_id, store_id, member_id, used_at)
    values (p_jti, p_tenant_id, p_store_id, p_member_id, v_now);
  exception when unique_violation then
    select c.checked_at
    into v_latest_allow_at
    from public.checkins c
    where c.tenant_id = p_tenant_id
      and c.store_id = p_store_id
      and c.member_id = p_member_id
      and c.result = 'allow'
    order by c.checked_at desc
    limit 1;

    select count(*)
    into v_today_allow_count
    from public.checkins c
    where c.tenant_id = p_tenant_id
      and c.store_id = p_store_id
      and c.member_id = p_member_id
      and c.result = 'allow'
      and c.checked_at >= date_trunc('day', v_now);

    insert into public.checkins (tenant_id, store_id, member_id, jti, result, reason, checked_at)
    values (
      p_tenant_id,
      p_store_id,
      p_member_id,
      p_jti || ':rejected:' || gen_random_uuid()::text,
      'deny',
      'token_used',
      v_now
    );

    return query
    select
      'deny'::text,
      'token_used'::text,
      v_now,
      'none'::text,
      null::timestamptz,
      0::integer,
      v_latest_allow_at,
      v_today_allow_count;
    return;
  end;

  select c.checked_at
  into v_latest_allow_at
  from public.checkins c
  where c.tenant_id = p_tenant_id
    and c.store_id = p_store_id
    and c.member_id = p_member_id
    and c.result = 'allow'
  order by c.checked_at desc
  limit 1;

  select count(*)
  into v_today_allow_count
  from public.checkins c
  where c.tenant_id = p_tenant_id
    and c.store_id = p_store_id
    and c.member_id = p_member_id
    and c.result = 'allow'
    and c.checked_at >= date_trunc('day', v_now);

  if v_latest_allow_at is not null
     and v_latest_allow_at > (v_now - make_interval(mins => greatest(1, coalesce(p_anti_passback_minutes, 10)))) then
    insert into public.checkins (tenant_id, store_id, member_id, jti, result, reason, checked_at)
    values (p_tenant_id, p_store_id, p_member_id, p_jti, 'deny', 'already_checked_in_recently', v_now);

    return query
    select
      'deny'::text,
      'already_checked_in_recently'::text,
      v_now,
      'none'::text,
      null::timestamptz,
      0::integer,
      v_latest_allow_at,
      v_today_allow_count;
    return;
  end if;

  select *
  into v_subscription
  from public.subscriptions s
  where s.tenant_id = p_tenant_id
    and s.member_id = p_member_id
    and s.status = 'active'
    and s.valid_from <= v_now
    and s.valid_to >= v_now
  order by s.valid_to desc
  limit 1
  for update;

  if found then
    v_membership_kind := 'monthly';
  else
    select *
    into v_selected_pass
    from public.entry_passes p
    where p.tenant_id = p_tenant_id
      and p.member_id = p_member_id
      and p.status = 'active'
      and p.remaining > 0
      and (p.expires_at is null or p.expires_at >= v_now)
    order by p.expires_at asc nulls last, p.created_at asc
    limit 1
    for update;

    if found then
      update public.entry_passes
      set remaining = remaining - 1,
          updated_at = v_now
      where id = v_selected_pass.id
        and tenant_id = p_tenant_id
        and remaining > 0
      returning * into v_selected_pass;

      v_membership_kind := case when v_selected_pass.pass_type = 'single' then 'single' else 'punch' end;
    else
      v_reason := 'no_valid_pass';
    end if;
  end if;

  select coalesce(sum(p.remaining), 0)::integer
  into v_remaining_sessions
  from public.entry_passes p
  where p.tenant_id = p_tenant_id
    and p.member_id = p_member_id
    and p.status = 'active'
    and p.remaining > 0
    and (p.expires_at is null or p.expires_at >= v_now);

  if v_reason is null then
    insert into public.checkins (tenant_id, store_id, member_id, jti, result, reason, checked_at)
    values (p_tenant_id, p_store_id, p_member_id, p_jti, 'allow', null, v_now);

    return query
    select
      'allow'::text,
      null::text,
      v_now,
      v_membership_kind,
      case when v_membership_kind = 'monthly' then v_subscription.valid_to else null::timestamptz end,
      v_remaining_sessions,
      v_latest_allow_at,
      v_today_allow_count;
    return;
  end if;

  insert into public.checkins (tenant_id, store_id, member_id, jti, result, reason, checked_at)
  values (p_tenant_id, p_store_id, p_member_id, p_jti, 'deny', v_reason, v_now);

  return query
  select
    'deny'::text,
    v_reason,
    v_now,
    'none'::text,
    null::timestamptz,
    v_remaining_sessions,
    v_latest_allow_at,
    v_today_allow_count;
end;
$$;
