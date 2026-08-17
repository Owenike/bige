create or replace function public.redact_system_audit_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
  v_normalized_key text;
begin
  if p_value is null then
    return null;
  end if;

  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    v_result := '{}'::jsonb;
    for v_key, v_item in
      select item.key, item.value
      from pg_catalog.jsonb_each(p_value) as item
    loop
      v_normalized_key := pg_catalog.regexp_replace(
        pg_catalog.lower(v_key),
        '[^a-z0-9]',
        '',
        'g'
      );
      if v_normalized_key like '%password%'
        or v_normalized_key like '%passcode%'
        or v_normalized_key like '%token%'
        or v_normalized_key like '%secret%'
        or v_normalized_key in (
          'pin',
          'pincode',
          'authorization',
          'cookie',
          'signaturedata',
          'cardnumber',
          'cardno',
          'cvv',
          'cvc',
          'otp',
          'recoverycode',
          'activationcode'
        )
      then
        v_result := v_result || pg_catalog.jsonb_build_object(v_key, '[REDACTED]');
      else
        v_result := v_result || pg_catalog.jsonb_build_object(
          v_key,
          public.redact_system_audit_json(v_item)
        );
      end if;
    end loop;
    return v_result;
  end if;

  if pg_catalog.jsonb_typeof(p_value) = 'array' then
    v_result := '[]'::jsonb;
    for v_item in
      select item.value
      from pg_catalog.jsonb_array_elements(p_value) as item
    loop
      v_result := v_result || pg_catalog.jsonb_build_array(
        public.redact_system_audit_json(v_item)
      );
    end loop;
    return v_result;
  end if;

  return p_value;
end;
$function$;

revoke all on function public.redact_system_audit_json(jsonb) from public, anon, authenticated;
