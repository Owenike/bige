alter table public.trial_bookings
  add column if not exists staff_note text,
  add column if not exists staff_note_updated_at timestamptz,
  add column if not exists staff_note_updated_by uuid;

alter table public.trial_bookings
  drop constraint if exists trial_bookings_staff_note_length_check;

alter table public.trial_bookings
  add constraint trial_bookings_staff_note_length_check
  check (staff_note is null or char_length(staff_note) <= 500);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trial_bookings_staff_note_updated_by_fkey'
      and conrelid = 'public.trial_bookings'::regclass
  ) then
    alter table public.trial_bookings
      add constraint trial_bookings_staff_note_updated_by_fkey
      foreign key (staff_note_updated_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

comment on column public.trial_bookings.staff_note is
  'Internal list note. Saving this field must not create a contact record or change workflow grouping.';
comment on column public.trial_bookings.staff_note_updated_at is
  'Timestamp of the most recent internal list note update.';
comment on column public.trial_bookings.staff_note_updated_by is
  'Staff profile that most recently updated the internal list note.';
