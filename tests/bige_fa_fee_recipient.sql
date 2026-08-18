begin;

do $$
declare
  tenant_id uuid := '18000000-0000-4000-8000-000000000001';
  branch_id uuid := '18000000-0000-4000-8000-000000000002';
  manager_id uuid := '18000000-0000-4000-8000-000000000003';
  recipient_id uuid := '18000000-0000-4000-8000-000000000004';
  inactive_recipient_id uuid := '18000000-0000-4000-8000-000000000005';
  member_id uuid := '18000000-0000-4000-8000-000000000006';
  massage_trial_id uuid := '18000000-0000-4000-8000-000000000007';
  standard_trial_id uuid := '18000000-0000-4000-8000-000000000008';
  invalid_trial_id uuid := '18000000-0000-4000-8000-000000000009';
  massage_booking_id uuid := '18000000-0000-4000-8000-000000000010';
  standard_booking_id uuid := '18000000-0000-4000-8000-000000000011';
  invalid_booking_id uuid := '18000000-0000-4000-8000-000000000012';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (
    manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fa-fee-manager@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    recipient_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fa-fee-recipient@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    inactive_recipient_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fa-fee-inactive@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'FA FEE RECIPIENT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'FA FEE RECIPIENT TEST', 'FAFR', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, english_name, is_active,
    employee_number, department, position
  ) values
  (
    manager_id, tenant_id, branch_id, 'manager', '測試經理', 'Manager', true,
    'E999990', 'coaching', 'coach_manager'
  ),
  (
    recipient_id, tenant_id, branch_id, 'frontdesk', '測試收款人', 'Recipient', true,
    'E999991', 'general_affairs', 'frontdesk'
  ),
  (
    inactive_recipient_id, tenant_id, branch_id, 'frontdesk', '已停用收款人', 'Inactive', false,
    'E999992', 'general_affairs', 'frontdesk'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, phone_normalized, email,
    email_unavailable, birth_date, status, is_prospect
  ) values (
    member_id, tenant_id, branch_id, 'FA Fee Member', '0918999001',
    '0918999001', 'fa-fee-member@test.local', false, '1990-01-01', 'active', true
  );

  insert into public.trial_bookings (
    id, name, phone, service, preferred_time, payment_method, payment_status,
    amount, currency, source, booking_status, member_id
  ) values
  (
    massage_trial_id, 'Massage Trial', '0918999001', 'sports_massage',
    'weekday_morning', 'cash_on_site', 'pending_cash', 1500, 'TWD', 'website',
    'scheduled', member_id
  ),
  (
    standard_trial_id, 'Standard Trial', '0918999001', 'weight_training',
    'weekday_morning', 'cash_on_site', 'pending_cash', 880, 'TWD', 'website',
    'scheduled', member_id
  ),
  (
    invalid_trial_id, 'Invalid Recipient Trial', '0918999001', 'pilates',
    'weekday_morning', 'cash_on_site', 'pending_cash', 880, 'TWD', 'website',
    'scheduled', member_id
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind, course_type,
    trial_stage, trial_booking_id, operation_idempotency_key
  ) values
  (
    massage_booking_id, tenant_id, branch_id, member_id, manager_id,
    '運動按摩', now() - interval '9 hours', now() - interval '7 hours', 'booked',
    true, 'trial', 'relaxation', 'FA1', massage_trial_id, 'test:fa-fee:massage'
  ),
  (
    standard_booking_id, tenant_id, branch_id, member_id, manager_id,
    '重量訓練', now() - interval '6 hours', now() - interval '4 hours', 'booked',
    true, 'trial', 'weight_training', 'FA1', standard_trial_id, 'test:fa-fee:standard'
  ),
  (
    invalid_booking_id, tenant_id, branch_id, member_id, manager_id,
    '器械皮拉提斯', now() - interval '3 hours', now() - interval '1 hour', 'booked',
    true, 'trial', 'reformer_pilates', 'FA1', invalid_trial_id, 'test:fa-fee:invalid'
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform public.bige_complete_trial_outcome_v2(
    massage_booking_id, 'not_converted', recipient_id, 'client label is not trusted'
  );

  if not exists (
    select 1
    from public.bookings
    where id = massage_booking_id
      and status = 'completed'
      and trial_conversion_outcome = 'not_converted'
      and fa_fee_amount = 1500
      and fa_fee_recipient_profile_id = recipient_id
      and fa_fee_recipient_name = 'Recipient｜E999991'
      and fa_fee_recorded_by = manager_id
      and fa_fee_recorded_at is not null
  ) then
    raise exception 'sports massage recipient or 1500 fee was not stored';
  end if;

  perform public.bige_complete_trial_outcome_v2(
    standard_booking_id, 'not_converted', null, '外部收款人'
  );

  if not exists (
    select 1
    from public.bookings
    where id = standard_booking_id
      and status = 'completed'
      and fa_fee_amount = 880
      and fa_fee_recipient_profile_id is null
      and fa_fee_recipient_name = '外部收款人'
  ) then
    raise exception 'free-text recipient or 880 fee was not stored';
  end if;

  begin
    perform public.bige_complete_trial_outcome_v2(
      invalid_booking_id, 'not_converted', inactive_recipient_id, 'Inactive'
    );
    raise exception 'inactive recipient unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'fa_fee_recipient_profile_invalid' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.bookings
    where id = invalid_booking_id
      and status = 'booked'
      and trial_conversion_outcome is null
      and fa_fee_amount is null
      and fa_fee_recipient_name is null
  ) then
    raise exception 'failed recipient did not roll back the FA outcome atomically';
  end if;
end;
$$;

rollback;
