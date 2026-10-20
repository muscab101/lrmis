-- ============================================================================
-- 0048 A property type priced in SOS needs an exchange rate on file, because
-- its price is billed in USD at the day's rate (0047).
-- ============================================================================

create or replace function public.property_type_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_code text;
  v_price numeric := coalesce(nullif(p ->> 'price', '')::numeric, 0);
begin
  perform private.assert_permission('settings.update');
  if length(coalesce(trim(p ->> 'name_so'), '')) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_so');
  end if;
  if length(coalesce(trim(p ->> 'name_en'), '')) < 2 then
    perform private.raise_app_error('VALIDATION', 'name_en');
  end if;
  if v_price < 0 then
    perform private.raise_app_error('VALIDATION', 'price');
  end if;
  -- A price in SOS is billed in USD at the day's rate, so a rate must exist.
  if coalesce(nullif(p ->> 'currency', ''), 'USD') <> 'USD' and v_price > 0
     and not exists (select 1 from public.fx_rates where currency = p ->> 'currency' and rate_date <= current_date) then
    perform private.raise_app_error('VALIDATION', 'fx_rate_missing');
  end if;
  if p_id is null then
    v_code := left(trim(both '_' from regexp_replace(lower(trim(p ->> 'name_en')), '[^a-z0-9]+', '_', 'g')), 34);
    if length(v_code) < 2 then
      v_code := 'type';
    end if;
    -- Keep codes unique: add a number when the name was used before.
    if exists (select 1 from public.property_types where code = v_code) then
      v_code := v_code || '_' || (select count(*) + 1 from public.property_types where code like v_code || '%');
    end if;
    insert into public.property_types (code, name_so, name_en, price, currency, active, sort, created_by)
    values (v_code, trim(p ->> 'name_so'), trim(p ->> 'name_en'), round(v_price, 2),
            coalesce(nullif(p ->> 'currency', ''), 'USD'), coalesce((p ->> 'active')::boolean, true),
            coalesce(nullif(p ->> 'sort', '')::int, 100), auth.uid())
    returning id into v_id;
  else
    update public.property_types
       set name_so = trim(p ->> 'name_so'), name_en = trim(p ->> 'name_en'), price = round(v_price, 2),
           currency = coalesce(nullif(p ->> 'currency', ''), currency),
           active = coalesce((p ->> 'active')::boolean, active),
           sort = coalesce(nullif(p ->> 'sort', '')::int, sort)
     where id = p_id;
    if not found then
      perform private.raise_app_error('NOT_FOUND', 'property_type');
    end if;
  end if;
  return v_id;
end;
$$;

