-- "select value from jsonb_array_elements(...)" clashed with the plpgsql variable named value, so any CRM metadata
-- holding an array (e.g. whatsapp_template.placeholders) failed with 'column reference "value" is ambiguous'.
CREATE OR REPLACE FUNCTION private.redact_crm_metadata(input jsonb, allow_values boolean, allow_customers boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  result jsonb;
  key text;
  value jsonb;
  item jsonb;
  customer_keys constant text[] := array[
    'customer','buyer','contact','customer_name','buyer_name','full_name',
    'email','buyer_email','customer_email','phone','mobile','whatsapp',
    'customer_whatsapp','cpf','cnpj','document','document_number','address'
  ];
  financial_keys constant text[] := array[
    'amount','currency','value','price','total','subtotal','revenue','gross',
    'net','fee','fees','tax','taxes','discount','balance','transaction_amount',
    'payment_amount','order_total','unit_amount'
  ];
begin
  if input is null then
    return null;
  end if;

  case jsonb_typeof(input)
    when 'object' then
      result := '{}'::jsonb;
      for key, value in select * from jsonb_each(input)
      loop
        if (not allow_customers and lower(key) = any(customer_keys))
           or (not allow_values and lower(key) = any(financial_keys)) then
          continue;
        end if;
        result := result || jsonb_build_object(
          key,
          private.redact_crm_metadata(value, allow_values, allow_customers)
        );
      end loop;
      return result;

    when 'array' then
      result := '[]'::jsonb;
      for item in select e from jsonb_array_elements(input) as e
      loop
        result := result || jsonb_build_array(
          private.redact_crm_metadata(item, allow_values, allow_customers)
        );
      end loop;
      return result;

    else
      return input;
  end case;
end;
$function$

;
