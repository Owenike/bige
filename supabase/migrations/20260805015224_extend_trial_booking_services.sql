alter table public.trial_bookings
  drop constraint if exists trial_bookings_service_check;

alter table public.trial_bookings
  add constraint trial_bookings_service_check
  check (
    service in (
      'weight_training',
      'boxing_fitness',
      'pilates',
      'sports_massage',
      'onsite_assessment'
    )
  );;
