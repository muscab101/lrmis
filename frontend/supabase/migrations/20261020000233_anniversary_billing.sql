-- Automatic billing on each property's own anniversary instead of once a year on 1 January.
--
-- Each property has a tax anniversary: the day its first certificate was issued (or, without one, the day it was
-- registered). A certificate is valid until the next anniversary. Every day the system looks for properties whose
-- anniversary has arrived: their certificate expires and a new tax bill is made for that year. When the bill is paid
-- in full, a new certificate is issued by itself, valid until the next anniversary.
-- The anniversary stays fixed: paying late does not move it, so no year is skipped or billed twice.
-- Manual billing runs (New billing run) stay as a backup.

-- 1. The anniversary of each property.
alter table public.parcels add column if not exists tax_anniversary date;
comment on column public.parcels.tax_anniversary is 'Day the yearly tax bill comes and the certificate ends (first certificate, else registration).';

-- The anniversary is bookkeeping: a locked parcel still gets it (the lock keeps everything else as it is).
do $$
declare
  d text := pg_get_functiondef('private.parcel_lock_guard()'::regprocedure);
  a text := 'array[''locked_at'', ''locked_by'', ''lock_reason'', ''updated_at'']';
begin
  if position(a in d) = 0 then
    raise exception 'parcel_lock_guard: list not found';
  end if;
  -- centroid is worked out from the boundary after this check (it always looks changed here); the boundary itself is still guarded.
  execute replace(d, a, 'array[''locked_at'', ''locked_by'', ''lock_reason'', ''updated_at'', ''tax_anniversary'', ''centroid'']');
end $$;

update public.parcels p
   set tax_anniversary = coalesce(
         (select min(d.issued_at)::date from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status <> 'cancelled'),
         p.registered_at::date)
 where p.tax_anniversary is null and p.registered_at is not null
   and p.building_state is distinct from 'demolished'; -- demolished land is an archive and is never billed

/** The next anniversary after today (at least one year after the anniversary itself). */
create or replace function private.next_anniversary(p_anchor date)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_anchor + make_interval(years => greatest(1,
            (extract(year from age(current_date, p_anchor))::int + 1))))::date;
$$;

/** The last anniversary that has arrived (today or before), or null when the first year is not over yet. */
create or replace function private.last_anniversary(p_anchor date)
returns date
language sql
stable
set search_path = ''
as $$
  select case when p_anchor is null or extract(year from age(current_date, p_anchor))::int < 1 then null
              else (p_anchor + make_interval(years => extract(year from age(current_date, p_anchor))::int))::date end;
$$;

-- 2. A certificate is valid until the property's next anniversary (the first one sets the anniversary).
do $$
declare
  d text := pg_get_functiondef('private.issue_document(document_type,uuid,uuid,uuid)'::regprocedure);
  a1 text := '  insert into public.issued_documents (type, serial, verify_code, parcel_id, party_id, district_id, snapshot, issued_by, expires_at, replaces_id)';
  b1 text := '  if p_type = ''certificate'' and v_p.tax_anniversary is null then
    update public.parcels set tax_anniversary = current_date where id = p_parcel returning * into v_p;
  end if;
' || a1;
  a2 text := 'else make_date(v_year, 12, 31) end,';
  b2 text := 'else private.next_anniversary(v_p.tax_anniversary) end,';
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'issue_document: anchors not found';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

-- Certificates already issued follow the new rule.
update public.issued_documents d
   set expires_at = private.next_anniversary(p.tax_anniversary)
  from public.parcels p
 where p.id = d.parcel_id and d.type = 'certificate' and d.status = 'valid' and p.tax_anniversary is not null
   and p.building_state is distinct from 'demolished';

-- A certificate stops being valid on its anniversary day.
create or replace function private.documents_expire(p_parcel uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.issued_documents set status = 'expired'
   where status = 'valid' and expires_at is not null and expires_at <= current_date
     and (p_parcel is null or parcel_id = p_parcel);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 3. A run can be for a list of properties (the anniversary runs).
alter table public.billing_runs add column if not exists parcel_ids uuid[] not null default '{}';
do $$
declare
  d text := pg_get_functiondef('private.billing_run_candidates_all(billing_runs)'::regprocedure);
  a text := '      and p.district_id = any (p_run.district_ids)';
  b text := '      and p.district_id = any (p_run.district_ids)
      and (coalesce(cardinality(p_run.parcel_ids), 0) = 0 or p.id = any (p_run.parcel_ids))';
begin
  if position(a in d) = 0 then
    raise exception 'billing_run_candidates_all: scope not found';
  end if;
  execute replace(d, a, b);
end $$;

insert into public.settings (key, value, description)
values ('billing.anniversary_from', to_jsonb(current_date::text), 'Anniversaries from this day on are billed automatically (earlier years: manual runs)')
on conflict (key) do nothing;

/**
 * The daily job: certificates whose anniversary has come expire, and each property whose anniversary has come gets
 * its tax bill for that year (one automatic run per district and year, issued at once, owners told by SMS).
 * Safe to run again the same day: what is billed is not billed twice.
 */
create or replace function private.billing_anniversary_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee uuid := (select id from public.fee_types where code = 'property_tax' and active limit 1);
  v_from date := coalesce((select (value #>> '{}')::date from public.settings where key = 'billing.anniversary_from'), current_date);
  v_expired int;
  g record;
  v public.billing_runs;
  v_runs int := 0;
  v_bills int := 0;
begin
  v_expired := private.documents_expire(null);
  if v_fee is null then
    return jsonb_build_object('expired', v_expired, 'runs', 0, 'bills', 0);
  end if;
  for g in
    select p.district_id, extract(year from private.last_anniversary(p.tax_anniversary))::int as yr, array_agg(p.id) as ids
      from public.parcels p
     where p.deleted_at is null and p.status in ('registered', 'disputed') and p.building_state = 'standing'
       and p.layout in ('house', 'flats') and p.tax_anniversary is not null
       and private.last_anniversary(p.tax_anniversary) between v_from and current_date
       -- Not billed yet since that anniversary.
       and not exists (select 1 from public.invoices i join public.fee_types f on f.id = i.fee_type_id
                        where i.parcel_id = p.id and f.code in ('property_tax', 'property_bill') and i.status <> 'cancelled'
                          and i.issue_date >= private.last_anniversary(p.tax_anniversary))
     group by 1, 2
  loop
    insert into public.billing_runs (number, year, period, fee_type_id, district_ids, parcel_ids, due_date, note, automatic)
    values ('BR-' || g.yr || '-' || lpad(private.next_serial('BR-' || g.yr)::text, 3, '0'), g.yr, g.yr::text, v_fee,
            array[g.district_id], g.ids, current_date + private.setting_int('billing.due_days', 60),
            'Anniversary bills ' || to_char(current_date, 'DD Mon YYYY'), true)
    returning * into v;
    update public.billing_runs set preview = private.billing_run_preview(v) where id = v.id returning * into v;
    if coalesce((v.preview ->> 'count')::int, 0) > 0 then
      update public.billing_runs set status = 'approved', submitted_at = now(), approved_at = now() where id = v.id;
      v_bills := v_bills + coalesce((private.billing_run_issue(v.id) ->> 'created')::int, 0);
      v_runs := v_runs + 1;
    else
      -- Everything was already billed for that year: no empty run is kept.
      delete from public.billing_runs where id = v.id;
    end if;
  end loop;
  return jsonb_build_object('expired', v_expired, 'runs', v_runs, 'bills', v_bills);
end;
$$;
revoke all on function private.billing_anniversary_daily() from public, anon, authenticated;

-- 4. Renewal: a yearly tax bill paid in full gives a new certificate by itself, when the property's certificate
--    expired on its anniversary (and nothing else is owed). A first certificate is still approved on Applications.
create or replace function private.tax_paid_certificate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.parcel_id is not null
     and exists (select 1 from public.fee_types f where f.id = new.fee_type_id and f.code = 'property_tax')
     and exists (select 1 from public.issued_documents d where d.parcel_id = new.parcel_id and d.type = 'certificate' and d.status = 'expired')
     and not exists (select 1 from public.issued_documents d where d.parcel_id = new.parcel_id and d.type = 'certificate' and d.status = 'valid') then
    begin
      perform private.try_auto_certificate(new.parcel_id);
    exception when others then
      perform private.parcel_event(new.parcel_id, 'auto_certificate_failed', left(sqlerrm, 200), '{}'::jsonb);
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists tax_paid_certificate on public.invoices;
create trigger tax_paid_certificate after update of status on public.invoices
  for each row execute function private.tax_paid_certificate();

-- 5. Daily instead of once a year (the 1 January jobs stop; their functions stay for a manual run).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('billing-auto-year', 'certificates-new-year', 'billing-anniversary');
    perform cron.schedule('billing-anniversary', '0 3 * * *', 'select private.billing_anniversary_daily()');
  end if;
end $$;
