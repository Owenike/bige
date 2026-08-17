-- Prevent a single or cumulative payment from exceeding the contract total.
-- The contract row is locked during later payments so concurrent requests
-- cannot both consume the same outstanding balance.

do $migration$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.bige_create_member_contract(uuid,uuid,uuid,uuid,text,text,date,text,boolean,uuid,date,text,bigint,text,jsonb,text)'::regprocedure
  ) into function_definition;

  if function_definition not like '%payment_amount_exceeds_contract_balance%' then
    original_definition := function_definition;
    function_definition := replace(
      function_definition,
      E'  if p_source_booking_id is not null then',
      E'  if p_initial_payment < 0 then\n    raise exception ''payment_amount_invalid'';\n  end if;\n\n  if p_initial_payment > plan_row.price_amount then\n    raise exception ''payment_amount_exceeds_contract_balance'';\n  end if;\n\n  if p_source_booking_id is not null then'
    );

    if function_definition = original_definition then
      raise exception 'bige_create_member_contract overpayment validation update failed';
    end if;

    execute function_definition;
  end if;

  select pg_get_functiondef(
    'public.bige_record_contract_payment(uuid,uuid,text,bigint,text,timestamptz,text,text)'::regprocedure
  ) into function_definition;

  if function_definition not like '%payment_amount_exceeds_contract_balance%' then
    original_definition := function_definition;
    function_definition := replace(
      function_definition,
      E'  if prior_paid = 0 then',
      E'  if p_amount > contract_row.total_amount - prior_paid then\n    raise exception ''payment_amount_exceeds_contract_balance'';\n  end if;\n\n  if prior_paid = 0 then'
    );

    if function_definition = original_definition then
      raise exception 'bige_record_contract_payment overpayment validation update failed';
    end if;

    execute function_definition;
  end if;
end;
$migration$;;
