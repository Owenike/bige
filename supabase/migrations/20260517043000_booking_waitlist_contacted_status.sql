alter table public.booking_waitlist
  drop constraint if exists booking_waitlist_status_check;

alter table public.booking_waitlist
  add constraint booking_waitlist_status_check
  check (status in ('pending', 'notified', 'contacted', 'booked', 'cancelled'));
