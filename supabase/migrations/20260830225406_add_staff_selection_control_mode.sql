alter table public.staff_schedule_periods
  add column if not exists selection_control_mode text not null default 'scheduled'
  check (selection_control_mode in ('scheduled', 'open', 'closed'));

comment on column public.staff_schedule_periods.selection_control_mode is
  'Controls employee time-off selection: scheduled follows the configured window, open forces it open, and closed forces it closed.';
