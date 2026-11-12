-- Duplicate bills: stop them being made, and let finance staff deal with each copy (cancel it, change its amount).
-- A duplicate is what "Check duplicates" finds: the same land with two open bills of the same kind (property bill,
-- service charge, property tax) issued in the same year — counted again from the time land is registered again after
-- a demolition. "Same year" is the year the bill is for (its period starts with it), not the day it was printed — so a
-- run for next year made in December is not taken for a copy.

/** The year a bill is for: the start of its period, or else the year it was issued. */
create or replace function private.invoice_bill_year(p_period text, p_issue date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when left(p_period, 4) ~ '^[0-9]{4}$' then left(p_period, 4)::int else extract(year from p_issue)::int end;
$$;
revoke all on function private.invoice_bill_year(text, date) from public, anon, authenticated;

-- "Check duplicates" uses the same year.
do $do$
declare
  v text := pg_get_functiondef('public.invoice_duplicates()'::regprocedure);
  v_new text := replace(v, 'partition by i.parcel_id, f.id, extract(year from i.issue_date),', 'partition by i.parcel_id, f.id, private.invoice_bill_year(i.period, i.issue_date),');
begin
  if v_new = v then
    raise exception 'invoice_duplicates: text not found';
  end if;
  execute v_new;
end;
$do$;

/** Refuses a second open bill of the same kind for the same land in the same year. */
create or replace function private.invoice_duplicate_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := (select code from public.fee_types where id = new.fee_type_id);
  v_era bigint;
begin
  if new.status = 'cancelled' or v_code not in ('property_bill', 'service_charge', 'property_tax') then
    return new;
  end if;
  -- Bills from after the land was registered again count apart from the ones before.
  v_era := (select count(*) from public.demolitions d where d.parcel_id = new.parcel_id and d.rebuilt_at <= coalesce(new.created_at, now()));
  if exists (
    select 1 from public.invoices i
     where i.parcel_id = new.parcel_id and i.fee_type_id = new.fee_type_id and i.status <> 'cancelled' and i.id <> new.id
       and private.invoice_bill_year(i.period, i.issue_date) = private.invoice_bill_year(new.period, new.issue_date)
       and (select count(*) from public.demolitions d where d.parcel_id = i.parcel_id and d.rebuilt_at <= i.created_at) = v_era) then
    perform private.raise_app_error('CONFLICT', 'duplicate_bill');
  end if;
  return new;
end;
$$;
revoke all on function private.invoice_duplicate_guard() from public, anon, authenticated;
create trigger duplicate_guard before insert on public.invoices
  for each row execute function private.invoice_duplicate_guard();

/** Change one bill's amount, with a reason: kept as a line on the bill; never below what is already paid or credited. */
create or replace function public.invoice_set_total(p_id uuid, p_total numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform private.assert_permission('invoices.update');
  select * into v from public.invoices where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'invoice');
  end if;
  if v.status = 'cancelled' then
    perform private.raise_app_error('CONFLICT', 'invoice_cancelled');
  end if;
  if p_total is null or p_total <= 0 or p_total > 100000000 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  if round(p_total, 2) < v.paid + v.credited then
    perform private.raise_app_error('CONFLICT', 'rebill_below_paid');
  end if;
  if length(v_reason) not between 5 and 500 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if round(p_total, 2) <> v.total then
    insert into public.invoice_lines (invoice_id, kind, description, amount, created_by)
    values (v.id, case when round(p_total, 2) < v.total then 'credit' else 'fee' end::public.invoice_line_kind,
            'Amount changed from ' || v.total || ' to ' || round(p_total, 2) || ' USD: ' || v_reason, round(p_total, 2) - v.total, auth.uid());
    update public.invoices set total = round(p_total, 2) where id = v.id;
    perform private.invoice_refresh_status(v.id);
    perform private.parcel_event(v.parcel_id, 'invoice_amount_changed', v_reason,
      jsonb_build_object('invoice', v.number, 'from', v.total, 'to', round(p_total, 2)));
  end if;
  return (select jsonb_build_object('number', number, 'total', total, 'balance', balance, 'status', status) from public.invoices where id = v.id);
end;
$$;
revoke all on function public.invoice_set_total(uuid, numeric, text) from public, anon;
grant execute on function public.invoice_set_total(uuid, numeric, text) to authenticated;
