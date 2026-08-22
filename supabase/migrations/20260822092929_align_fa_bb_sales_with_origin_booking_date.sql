begin;

-- FA and BB revenue is displayed on the originating schedule card. Keep the
-- settlement inbox on that same business date, but never move a report that
-- a manager has already formally confirmed.
update public.staff_sales_events event
set
  business_date = (origin_booking.starts_at at time zone 'Asia/Taipei')::date,
  source_occurred_at = origin_booking.starts_at,
  metadata = coalesce(event.metadata, '{}'::jsonb) || jsonb_build_object(
    'paymentPaidAt', payment.paid_at,
    'settlementDateSource', 'origin_booking',
    'originBookingStartsAt', origin_booking.starts_at
  ),
  updated_at = now()
from public.bige_contract_payments payment
join public.member_plan_contracts contract
  on contract.id = payment.contract_id
join public.bookings origin_booking
  on origin_booking.id = contract.converted_from_booking_id
where event.tenant_id = payment.tenant_id
  and event.source_table = 'bige_contract_payments'
  and event.source_id = payment.id
  and event.source_type in ('fa', 'bb')
  and event.status <> 'daily_confirmed'
  and origin_booking.is_bige_schedule = true
  and origin_booking.operation_kind in ('trial', 'bb')
  and event.business_date is distinct from
    (origin_booking.starts_at at time zone 'Asia/Taipei')::date;

commit;
