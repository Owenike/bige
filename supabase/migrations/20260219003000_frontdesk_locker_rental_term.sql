alter table public.frontdesk_locker_rentals
  add column if not exists rental_term text not null default 'daily';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'frontdesk_locker_rentals_rental_term_check'
  ) then
    alter table public.frontdesk_locker_rentals
      add constraint frontdesk_locker_rentals_rental_term_check
      check (rental_term in ('daily', 'monthly', 'half_year', 'yearly', 'custom'));
  end if;
end $$;
