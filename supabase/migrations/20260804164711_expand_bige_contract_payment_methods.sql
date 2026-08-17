-- Add ECPay single-payment and installment methods while keeping legacy
-- card-terminal records readable and valid.

alter table public.bige_contract_payments
  drop constraint if exists bige_contract_payments_method_check;

alter table public.bige_contract_payments
  add constraint bige_contract_payments_method_check
  check (
    method in (
      'cash',
      'bank_transfer',
      'card_terminal',
      'ecpay',
      'ecpay_installment',
      'acpay',
      'other'
    )
  );

do $$
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

  if function_definition not like '%''ecpay_installment''%' then
    raise exception 'bige_create_member_contract payment validation update failed';
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

  if function_definition not like '%''ecpay_installment''%' then
    raise exception 'bige_record_contract_payment validation update failed';
  end if;

  execute function_definition;
end;
$$;;
