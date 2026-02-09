-- Post-migration checks for BIGE.
-- Run after all migrations are applied.

-- 1) Core tables
select 'table.tenants' as check_name, to_regclass('public.tenants') is not null as ok;
select 'table.branches' as check_name, to_regclass('public.branches') is not null as ok;
select 'table.profiles' as check_name, to_regclass('public.profiles') is not null as ok;
select 'table.members' as check_name, to_regclass('public.members') is not null as ok;
select 'table.subscriptions' as check_name, to_regclass('public.subscriptions') is not null as ok;
select 'table.entry_passes' as check_name, to_regclass('public.entry_passes') is not null as ok;
select 'table.bookings' as check_name, to_regclass('public.bookings') is not null as ok;
select 'table.session_redemptions' as check_name, to_regclass('public.session_redemptions') is not null as ok;
select 'table.orders' as check_name, to_regclass('public.orders') is not null as ok;
select 'table.order_items' as check_name, to_regclass('public.order_items') is not null as ok;
select 'table.payments' as check_name, to_regclass('public.payments') is not null as ok;
select 'table.audit_logs' as check_name, to_regclass('public.audit_logs') is not null as ok;
select 'table.frontdesk_shifts' as check_name, to_regclass('public.frontdesk_shifts') is not null as ok;
select 'table.frontdesk_shift_items' as check_name, to_regclass('public.frontdesk_shift_items') is not null as ok;
select 'table.feature_flags' as check_name, to_regclass('public.feature_flags') is not null as ok;
select 'table.checkins' as check_name, to_regclass('public.checkins') is not null as ok;
select 'table.qr_token_uses' as check_name, to_regclass('public.qr_token_uses') is not null as ok;
select 'table.notification_logs' as check_name, to_regclass('public.notification_logs') is not null as ok;

-- 2) Critical functions
select
  'fn.redeem_session' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'redeem_session'
  ) as ok;

select
  'fn.member_modify_booking' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_modify_booking'
  ) as ok;

select
  'fn.apply_newebpay_webhook' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_newebpay_webhook'
  ) as ok;

select
  'fn.verify_entry_scan' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_entry_scan'
  ) as ok;

-- 3) Important indexes
select
  'idx.session_redemptions_booking_unique' as check_name,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'session_redemptions_booking_unique'
  ) as ok;

select
  'idx.checkins_jti_idx' as check_name,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'checkins_jti_idx'
  ) as ok;

-- 4) RLS enabled checks
select 'rls.members' as check_name, relrowsecurity as ok
from pg_class
where oid = 'public.members'::regclass;

select 'rls.bookings' as check_name, relrowsecurity as ok
from pg_class
where oid = 'public.bookings'::regclass;

select 'rls.entry_passes' as check_name, relrowsecurity as ok
from pg_class
where oid = 'public.entry_passes'::regclass;

select 'rls.checkins' as check_name, relrowsecurity as ok
from pg_class
where oid = 'public.checkins'::regclass;

select 'rls.qr_token_uses' as check_name, relrowsecurity as ok
from pg_class
where oid = 'public.qr_token_uses'::regclass;
