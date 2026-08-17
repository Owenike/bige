alter table public.trial_bookings
  add column if not exists schedule_note text;

alter table public.trial_bookings
  drop constraint if exists trial_bookings_schedule_note_length_check;

alter table public.trial_bookings
  add constraint trial_bookings_schedule_note_length_check
  check (schedule_note is null or char_length(schedule_note) <= 500);

comment on column public.trial_bookings.schedule_note is
  'Staff-entered arrangement note. Kept separate from the customer-supplied trial_bookings.note.';
