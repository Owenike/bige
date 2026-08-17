begin;

-- Later FA migrations replaced the contract-creation function from an older
-- definition and accidentally removed the two ECPay methods added on 2026-08-04.
-- Patch the live definition instead of copying the entire function again, so
-- future validation and permission changes remain intact.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bige_create_member_contract(uuid,uuid,uuid,uuid,text,text,date,text,boolean,uuid,date,text,bigint,text,jsonb,text)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    'if p_payment_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''acpay'', ''other'') then',
    'if p_payment_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''ecpay'', ''ecpay_installment'', ''acpay'', ''other'') then'
  );

  if function_definition not like
    '%p_payment_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''ecpay'', ''ecpay_installment'', ''acpay'', ''other'')%'
  then
    raise exception 'bige_create_member_contract ECPay validation patch failed';
  end if;

  if function_definition not like '%member_was_prospect_before_conversion boolean%' then
    function_definition := replace(
      function_definition,
      E'  unlocked integer := 0;\nbegin',
      E'  unlocked integer := 0;\n  member_was_prospect_before_conversion boolean := false;\n  member_code_before_conversion text;\nbegin'
    );

    function_definition := replace(
      function_definition,
      E'  member_code_value := coalesce(member_row.member_code, public.next_bige_member_code());',
      E'  member_was_prospect_before_conversion := p_source_booking_id is not null\n    and coalesce(member_row.is_prospect, false)\n    and member_row.member_code is null;\n  member_code_before_conversion := member_row.member_code;\n\n  member_code_value := coalesce(member_row.member_code, public.next_bige_member_code());'
    );

    function_definition := replace(
      function_definition,
      E'      ''initialPayment'', p_initial_payment\n    )',
      E'      ''initialPayment'', p_initial_payment,\n      ''memberWasProspectBeforeConversion'', member_was_prospect_before_conversion,\n      ''memberCodeBeforeConversion'', member_code_before_conversion\n    )'
    );
  end if;

  if function_definition not like '%memberWasProspectBeforeConversion%'
     or function_definition not like '%memberCodeBeforeConversion%'
  then
    raise exception 'bige_create_member_contract member snapshot patch failed';
  end if;

  execute function_definition;

  select pg_get_functiondef(
    'public.bige_record_contract_payment(uuid,uuid,text,bigint,text,timestamptz,text,text)'::regprocedure
  ) into function_definition;

  function_definition := replace(
    function_definition,
    'if p_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''acpay'', ''other'') then',
    'if p_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''ecpay'', ''ecpay_installment'', ''acpay'', ''other'') then'
  );

  if function_definition not like
    '%p_method not in (''cash'', ''bank_transfer'', ''card_terminal'', ''ecpay'', ''ecpay_installment'', ''acpay'', ''other'')%'
  then
    raise exception 'bige_record_contract_payment ECPay validation patch failed';
  end if;

  execute function_definition;
end;
$migration$;

-- Restore a converted FA to its original prospect identity only when that
-- conversion was what promoted the person and no later formal-member activity
-- depends on the identity. The member row itself must remain because the FA
-- booking references it.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bige_restore_fa_conversion(uuid)'::regprocedure
  ) into function_definition;

  if function_definition not like '%member_reverted_to_prospect boolean%' then
    function_definition := replace(
      function_definition,
      E'  dependent_count integer := 0;\nbegin',
      E'  dependent_count integer := 0;\n  conversion_audit_payload jsonb := ''{}''::jsonb;\n  member_reverted_to_prospect boolean := false;\nbegin'
    );

    function_definition := replace(
      function_definition,
      E'  if not found or contract_row.status = ''canceled'' then\n    raise exception ''fa_conversion_restore_not_available'';\n  end if;',
      E'  if not found or contract_row.status = ''canceled'' then\n    raise exception ''fa_conversion_restore_not_available'';\n  end if;\n\n  select coalesce(audit.payload, ''{}''::jsonb)\n  into conversion_audit_payload\n  from public.audit_logs audit\n  where audit.tenant_id = booking_row.tenant_id\n    and audit.action = ''trial_converted_to_member''\n    and audit.target_type = ''member_plan_contract''\n    and audit.target_id = contract_row.id::text\n  order by audit.created_at desc\n  limit 1;'
    );

    function_definition := replace(
      function_definition,
      E'  insert into public.audit_logs (\n    tenant_id, actor_id, action, target_type, target_id, reason, payload\n  ) values (',
      E'  if coalesce((conversion_audit_payload->>''memberWasProspectBeforeConversion'')::boolean, false)\n     and conversion_audit_payload->>''memberCodeBeforeConversion'' is null\n     and exists (\n       select 1\n       from public.members member_row\n       where member_row.id = contract_row.member_id\n         and member_row.tenant_id = booking_row.tenant_id\n         and member_row.auth_user_id is null\n         and member_row.portal_activated_at is null\n     )\n     and not exists (\n       select 1\n       from public.member_plan_contracts other_contract\n       where other_contract.tenant_id = booking_row.tenant_id\n         and other_contract.member_id = contract_row.member_id\n         and other_contract.id <> contract_row.id\n         and other_contract.status <> ''canceled''\n     )\n     and not exists (\n       select 1\n       from public.member_plan_contract_members shared_member\n       join public.member_plan_contracts shared_contract\n         on shared_contract.id = shared_member.contract_id\n        and shared_contract.tenant_id = shared_member.tenant_id\n       where shared_member.tenant_id = booking_row.tenant_id\n         and shared_member.member_id = contract_row.member_id\n         and shared_member.contract_id <> contract_row.id\n         and shared_contract.status <> ''canceled''\n     )\n     and not exists (\n       select 1\n       from public.bookings other_booking\n       where other_booking.tenant_id = booking_row.tenant_id\n         and other_booking.member_id = contract_row.member_id\n         and other_booking.id <> booking_row.id\n         and other_booking.operation_kind = ''pt''\n         and other_booking.status <> ''cancelled''\n     )\n     and not exists (select 1 from public.session_redemptions redemption where redemption.tenant_id = booking_row.tenant_id and redemption.member_id = contract_row.member_id)\n     and not exists (select 1 from public.entry_passes pass where pass.tenant_id = booking_row.tenant_id and pass.member_id = contract_row.member_id)\n     and not exists (select 1 from public.subscriptions subscription where subscription.tenant_id = booking_row.tenant_id and subscription.member_id = contract_row.member_id)\n  then\n    update public.members\n    set member_code = null,\n        is_prospect = true,\n        attendance_pin_hash = null,\n        attendance_pin_set_at = null,\n        attendance_pin_reset_required = false,\n        updated_at = now()\n    where id = contract_row.member_id\n      and tenant_id = booking_row.tenant_id;\n    member_reverted_to_prospect := found;\n  end if;\n\n  insert into public.audit_logs (\n    tenant_id, actor_id, action, target_type, target_id, reason, payload\n  ) values ('
    );

    function_definition := replace(
      function_definition,
      E'      ''previousUnlockedSessions'', contract_row.unlocked_sessions\n    )',
      E'      ''previousUnlockedSessions'', contract_row.unlocked_sessions,\n      ''memberRevertedToProspect'', member_reverted_to_prospect\n    )'
    );

    function_definition := replace(
      function_definition,
      E'    ''contractId'', contract_row.id,\n    ''restored'', true',
      E'    ''contractId'', contract_row.id,\n    ''restored'', true,\n    ''memberRevertedToProspect'', member_reverted_to_prospect'
    );
  end if;

  if function_definition not like '%member_reverted_to_prospect boolean%'
     or function_definition not like '%memberWasProspectBeforeConversion%'
     or function_definition not like '%memberRevertedToProspect%'
  then
    raise exception 'bige_restore_fa_conversion prospect restore patch failed';
  end if;

  execute function_definition;
end;
$migration$;

-- Repair the already-restored conversion reported on 2026-08-16. All guards
-- make this a no-op unless the exact canceled contract, voided initial payment,
-- restored FA, and dependency-free member state are still present.
with repaired as (
  update public.members member_row
  set member_code = null,
      is_prospect = true,
      attendance_pin_hash = null,
      attendance_pin_set_at = null,
      attendance_pin_reset_required = false,
      updated_at = now()
  where member_row.id = 'ce8e5cb6-e709-4dad-9347-2f77b010ccd3'::uuid
    and member_row.member_code = 'E000156'
    and member_row.is_prospect = false
    and member_row.auth_user_id is null
    and member_row.portal_activated_at is null
    and exists (
      select 1
      from public.member_plan_contracts contract_row
      join public.bookings booking_row
        on booking_row.id = contract_row.converted_from_booking_id
      where contract_row.id = '830c5e07-92ec-4d93-b16b-7588b43959fa'::uuid
        and contract_row.member_id = member_row.id
        and contract_row.status = 'canceled'
        and contract_row.payment_status = 'refunded'
        and booking_row.member_id = member_row.id
        and booking_row.operation_kind = 'trial'
        and booking_row.converted_at is null
        and booking_row.converted_contract_id is null
        and booking_row.status_reason = 'fa_conversion_restored'
    )
    and exists (
      select 1
      from public.bige_contract_payments payment
      where payment.contract_id = '830c5e07-92ec-4d93-b16b-7588b43959fa'::uuid
        and payment.idempotency_key = 'contract-create:830c5e07-92ec-4d93-b16b-7588b43959fa'
        and payment.status = 'voided'
    )
    and not exists (
      select 1 from public.member_plan_contracts other_contract
      where other_contract.member_id = member_row.id
        and other_contract.id <> '830c5e07-92ec-4d93-b16b-7588b43959fa'::uuid
    )
    and not exists (
      select 1 from public.member_plan_contract_members shared_member
      where shared_member.member_id = member_row.id
        and shared_member.contract_id <> '830c5e07-92ec-4d93-b16b-7588b43959fa'::uuid
    )
    and not exists (
      select 1 from public.bookings other_booking
      where other_booking.member_id = member_row.id
        and other_booking.operation_kind is distinct from 'trial'
    )
    and not exists (select 1 from public.session_redemptions redemption where redemption.member_id = member_row.id)
    and not exists (select 1 from public.entry_passes pass where pass.member_id = member_row.id)
    and not exists (select 1 from public.subscriptions subscription where subscription.member_id = member_row.id)
  returning member_row.id
)
insert into public.audit_logs (
  tenant_id, actor_id, action, target_type, target_id, reason, payload
)
select
  '3bc12d76-e8b6-4dd0-a87d-2048b495ff0c'::uuid,
  null,
  'fa_conversion_member_reverted_to_prospect_backfill',
  'member',
  repaired.id::text,
  'restore_formal_member_identity_cleanup',
  jsonb_build_object(
    'bookingId', 'f7a2ec13-9a0f-45d9-8f02-1ff28d6d252b',
    'contractId', '830c5e07-92ec-4d93-b16b-7588b43959fa',
    'previousMemberCode', 'E000156'
  )
from repaired;

commit;
