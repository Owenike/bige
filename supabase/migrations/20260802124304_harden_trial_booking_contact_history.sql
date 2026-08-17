create index if not exists trial_booking_contact_logs_booking_idx
  on public.trial_booking_contact_logs (trial_booking_id);

create index if not exists trial_booking_contact_logs_operator_idx
  on public.trial_booking_contact_logs (contacted_by)
  where contacted_by is not null;

create policy trial_booking_contact_logs_deny_client_access
  on public.trial_booking_contact_logs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

;
