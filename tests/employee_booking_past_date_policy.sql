begin;

do $$
<<employee_booking_past_date_test>>
declare
  tenant_id uuid := '26082600-0000-4000-8000-000000000001';
  branch_id uuid := '26082600-0000-4000-8000-000000000002';
  manager_id uuid := '26082600-0000-4000-8000-000000000003';
  assistant_id uuid := '26082600-0000-4000-8000-000000000004';
  team_lead_id uuid := '26082600-0000-4000-8000-000000000005';
  frontdesk_id uuid := '26082600-0000-4000-8000-000000000006';
  platform_admin_id uuid := '26082600-0000-4000-8000-000000000007';
  member_id uuid := '26082600-0000-4000-8000-000000000008';
  cancelled_past_id uuid := '26082600-0000-4000-8000-000000000009';
  active_past_id uuid := '26082600-0000-4000-8000-000000000010';
  future_id uuid := '26082600-0000-4000-8000-000000000011';
  manager_past_id uuid := '26082600-0000-4000-8000-000000000012';
  assistant_past_id uuid := '26082600-0000-4000-8000-000000000013';
  today_id uuid := '26082600-0000-4000-8000-000000000014';
  system_past_id uuid := '26082600-0000-4000-8000-000000000015';
  yesterday_start timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Taipei') - interval '1 day' + interval '10 hours')
    at time zone 'Asia/Taipei';
  today_start timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  future_start timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Taipei') + interval '2 days 10 hours')
    at time zone 'Asia/Taipei';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'past-date-manager@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  (assistant_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'past-date-assistant@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  (team_lead_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'past-date-lead@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  (frontdesk_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'past-date-frontdesk@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  (platform_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'past-date-platform@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (id, name, status)
  values (tenant_id, 'EMPLOYEE PAST BOOKING TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'EMPLOYEE PAST BOOKING TEST', 'PASTDATE', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values
  (manager_id, tenant_id, branch_id, 'manager', 'Past Date Manager', true, 'E999961', 'coaching', 'coach_manager'),
  (assistant_id, tenant_id, branch_id, 'supervisor', 'Past Date Assistant', true, 'E999962', 'coaching', 'coach_assistant_manager'),
  (team_lead_id, tenant_id, branch_id, 'coach', 'Past Date Lead', true, 'E999963', 'coaching', 'coach_team_lead'),
  (frontdesk_id, tenant_id, branch_id, 'frontdesk', 'Past Date Frontdesk', true, 'E999964', 'general_affairs', 'frontdesk'),
  (platform_admin_id, tenant_id, branch_id, 'platform_admin', 'Past Date Platform', true, 'E999965', null, null);

  insert into public.members (
    id, tenant_id, store_id, full_name, status, is_prospect, member_code
  ) values (
    member_id, tenant_id, branch_id, 'Past Date Test Member', 'active', false, 'E899961'
  );

  -- Trusted system fixtures represent existing history and import behavior.
  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, source
  ) values
  (cancelled_past_id, tenant_id, branch_id, member_id, team_lead_id, 'Past cancelled', yesterday_start, yesterday_start + interval '30 minutes', 'cancelled', 'system_test'),
  (active_past_id, tenant_id, branch_id, member_id, frontdesk_id, 'Past active', yesterday_start + interval '1 hour', yesterday_start + interval '90 minutes', 'booked', 'system_test'),
  (system_past_id, tenant_id, branch_id, member_id, platform_admin_id, 'Past import', yesterday_start + interval '2 hours', yesterday_start + interval '150 minutes', 'booked', 'system_import');

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', frontdesk_id::text, true);

  begin
    insert into public.bookings (
      tenant_id, branch_id, member_id, coach_id, service_name,
      starts_at, ends_at, status, source
    ) values (
      tenant_id, branch_id, member_id, frontdesk_id, 'Blocked frontdesk past',
      yesterday_start + interval '3 hours', yesterday_start + interval '210 minutes', 'booked', 'staff'
    );
    raise exception 'frontdesk unexpectedly created a past booking';
  exception
    when others then
      if sqlerrm <> 'past_employee_booking_requires_manager' then raise; end if;
  end;

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, source
  ) values (
    today_id, tenant_id, branch_id, member_id, frontdesk_id, 'Today is allowed',
    today_start, today_start + interval '30 minutes', 'booked', 'staff'
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, source
  ) values (
    future_id, tenant_id, branch_id, member_id, frontdesk_id, 'Future is allowed',
    future_start, future_start + interval '30 minutes', 'booked', 'staff'
  );

  update public.bookings
  set status = 'cancelled', note = 'closing existing history is allowed'
  where id = active_past_id;

  begin
    update public.bookings set status = 'booked' where id = cancelled_past_id;
    raise exception 'frontdesk unexpectedly restored a cancelled past booking';
  exception
    when others then
      if sqlerrm <> 'past_employee_booking_requires_manager' then raise; end if;
  end;

  begin
    update public.bookings
    set starts_at = yesterday_start + interval '4 hours',
        ends_at = yesterday_start + interval '270 minutes'
    where id = future_id;
    raise exception 'frontdesk unexpectedly moved a future booking into the past';
  exception
    when others then
      if sqlerrm <> 'past_employee_booking_requires_manager' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', team_lead_id::text, true);
  begin
    insert into public.bookings (
      tenant_id, branch_id, member_id, coach_id, service_name,
      starts_at, ends_at, status, source
    ) values (
      tenant_id, branch_id, member_id, team_lead_id, 'Blocked lead past',
      yesterday_start + interval '5 hours', yesterday_start + interval '330 minutes', 'booked', 'staff'
    );
    raise exception 'team lead unexpectedly created a past booking';
  exception
    when others then
      if sqlerrm <> 'past_employee_booking_requires_manager' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', platform_admin_id::text, true);
  begin
    insert into public.bookings (
      tenant_id, branch_id, member_id, coach_id, service_name,
      starts_at, ends_at, status, source
    ) values (
      tenant_id, branch_id, member_id, platform_admin_id, 'Blocked platform past',
      yesterday_start + interval '6 hours', yesterday_start + interval '390 minutes', 'booked', 'staff'
    );
    raise exception 'non-manager platform admin unexpectedly created a past booking';
  exception
    when others then
      if sqlerrm <> 'past_employee_booking_requires_manager' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, source
  ) values (
    manager_past_id, tenant_id, branch_id, member_id, manager_id, 'Manager past',
    yesterday_start + interval '7 hours', yesterday_start + interval '450 minutes', 'booked', 'staff'
  );
  update public.bookings set status = 'booked' where id = cancelled_past_id;

  perform set_config('request.jwt.claim.sub', assistant_id::text, true);
  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, source
  ) values (
    assistant_past_id, tenant_id, branch_id, member_id, assistant_id, 'Assistant past',
    yesterday_start + interval '8 hours', yesterday_start + interval '510 minutes', 'booked', 'staff'
  );

  if not exists (select 1 from public.bookings where id = manager_past_id)
    or not exists (select 1 from public.bookings where id = assistant_past_id)
    or not exists (select 1 from public.bookings where id = today_id)
    or not exists (select 1 from public.bookings where id = system_past_id)
    or not exists (select 1 from public.bookings where id = cancelled_past_id and status = 'booked') then
    raise exception 'manager, assistant manager, same-day, import, or restore allowance failed';
  end if;
end;
$$;

rollback;
