begin;

-- If moving an FA/BB sale leaves its former payment date with no coach-owned
-- receipts, remove only the unconfirmed daily-top result created from that
-- stale date. Confirmed EPO remains immutable and requires manager review.
with affected_old_dates as (
  select distinct
    event.tenant_id,
    event.branch_id,
    ((event.metadata ->> 'paymentPaidAt')::timestamptz at time zone 'Asia/Taipei')::date as old_date
  from public.staff_sales_events event
  where event.metadata ->> 'settlementDateSource' = 'origin_booking'
    and event.metadata ->> 'paymentPaidAt' is not null
    and event.business_date is distinct from
      ((event.metadata ->> 'paymentPaidAt')::timestamptz at time zone 'Asia/Taipei')::date
), empty_old_dates as (
  select affected.*
  from affected_old_dates affected
  where not exists (
    select 1
    from public.staff_sales_events current_event
    where current_event.tenant_id = affected.tenant_id
      and current_event.branch_id is not distinct from affected.branch_id
      and current_event.business_date = affected.old_date
      and current_event.source_type in ('fa', 'renewal', 'final_payment')
      and current_event.amount > 0
      and current_event.origin_employee_id is not null
      and coalesce(current_event.metadata ->> 'paymentStatus', '') not in ('refunded', 'voided')
  )
)
update public.staff_epo_awards award
set
  status = 'cancelled',
  review_note = '成交日期校正後，原付款日已無每日最高業績',
  updated_at = now()
from public.staff_epo_daily_top_states state
join empty_old_dates affected
  on affected.tenant_id = state.tenant_id
 and affected.branch_id is not distinct from state.branch_id
 and affected.old_date = state.business_date
where award.id = state.active_award_id
  and award.status <> 'daily_confirmed';

with affected_old_dates as (
  select distinct
    event.tenant_id,
    event.branch_id,
    ((event.metadata ->> 'paymentPaidAt')::timestamptz at time zone 'Asia/Taipei')::date as old_date
  from public.staff_sales_events event
  where event.metadata ->> 'settlementDateSource' = 'origin_booking'
    and event.metadata ->> 'paymentPaidAt' is not null
    and event.business_date is distinct from
      ((event.metadata ->> 'paymentPaidAt')::timestamptz at time zone 'Asia/Taipei')::date
), empty_old_dates as (
  select affected.*
  from affected_old_dates affected
  where not exists (
    select 1
    from public.staff_sales_events current_event
    where current_event.tenant_id = affected.tenant_id
      and current_event.branch_id is not distinct from affected.branch_id
      and current_event.business_date = affected.old_date
      and current_event.source_type in ('fa', 'renewal', 'final_payment')
      and current_event.amount > 0
      and current_event.origin_employee_id is not null
      and coalesce(current_event.metadata ->> 'paymentStatus', '') not in ('refunded', 'voided')
  )
)
update public.staff_epo_daily_top_states state
set
  top_amount = 0,
  candidate_employee_ids = '{}',
  selected_employee_id = null,
  status = 'none',
  active_award_id = null,
  source_fingerprint = '',
  decision_by = null,
  decision_at = null,
  updated_at = now()
from empty_old_dates affected
where state.tenant_id = affected.tenant_id
  and state.branch_id is not distinct from affected.branch_id
  and state.business_date = affected.old_date
  and not exists (
    select 1
    from public.staff_epo_awards award
    where award.id = state.active_award_id
      and award.status = 'daily_confirmed'
  );

commit;
