-- The tenant-scoped partial index serves schedule badge reads. This leading
-- source-booking index also covers foreign-key maintenance for every status.
create index if not exists bige_contract_payments_source_booking_fk_idx
  on public.bige_contract_payments(source_booking_id);
