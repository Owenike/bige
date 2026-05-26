alter table public.trial_bookings
  add column if not exists birthday date;

comment on column public.trial_bookings.birthday is '首次體驗預約者生日';
