begin;

alter table public.trial_bookings
  drop constraint if exists trial_bookings_source_check;

alter table public.trial_bookings
  add constraint trial_bookings_source_check
  check (source in ('website', 'official_line', 'walk_in', 'phone_booking', 'br'));

commit;;
