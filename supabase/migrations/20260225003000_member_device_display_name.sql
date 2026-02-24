-- Member device naming support for portal settings
-- Date: 2026-02-25

alter table if exists public.member_device_sessions
  add column if not exists display_name text;

alter table if exists public.member_device_sessions
  drop constraint if exists member_device_sessions_display_name_len_chk;

alter table if exists public.member_device_sessions
  add constraint member_device_sessions_display_name_len_chk
  check (display_name is null or char_length(display_name) <= 40);
