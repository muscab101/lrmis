-- Yearly land certificates.
--
-- A certificate now covers one tax year (1 January – 31 December) and says so. It also carries, frozen when issued:
--   · the year's bills, what was paid and the receipts, and "paid in full";
--   · how the yearly tax was worked out: property type, floors, taxable area × rate per m²;
--   · which certificate of the land it is, the one it follows, and what changed since then.
-- On 1 January last year's certificates expire. A new one is made by itself once the new year's bills are paid
-- (paying a bill already issues the certificate; it just could not while last year's was still "valid").

/** The tax-year part of a certificate for this land and year. */
create or replace function private.certificate_year_facts(p_parcel uuid, p_year int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_grade public.property_grades;
  v_bill_year int;
  v_bills jsonb;
  v_receipts jsonb;
  v_area numeric;
  v_tax numeric;
  v_prev public.issued_documents;
  v_seq int;
  v_changes text[] := '{}';
  v_valuation jsonb;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.property_type is not null then
    select * into v_grade from public.property_grades where code = v.property_type;
  end if;

  -- The year's bills; land billed before this year shows its latest bills instead.
  select coalesce(max(extract(year from i.issue_date)::int) filter (where extract(year from i.issue_date)::int = p_year),
                  max(extract(year from i.issue_date)::int))
    into v_bill_year
    from public.invoices i where i.parcel_id = p_parcel and i.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object(
           'number', i.number, 'fee_so', ft.name_so, 'fee_en', ft.name_en, 'code', ft.code,
           'total', i.total, 'paid', i.paid + i.credited, 'balance', i.balance) order by (ft.code = 'property_bill') desc, i.number), '[]'::jsonb)
    into v_bills
    from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
   where i.parcel_id = p_parcel and i.status <> 'cancelled' and extract(year from i.issue_date)::int = v_bill_year;

  select coalesce(jsonb_agg(jsonb_build_object('receipt_no', x.receipt_no, 'at', x.received_at, 'amount', x.amount) order by x.received_at), '[]'::jsonb)
    into v_receipts
    from (select p.receipt_no, p.received_at, sum(a.amount) as amount
            from public.payment_allocations a
            join public.payments p on p.id = a.payment_id and p.status = 'completed' and p.reversed_at is null
            join public.invoices i on i.id = a.invoice_id
           where i.parcel_id = p_parcel and i.status <> 'cancelled' and extract(year from i.issue_date)::int = v_bill_year
           group by p.id, p.receipt_no, p.received_at) x;

  -- How the yearly tax is worked out: taxable area × the property type's rate (the bills box shows what was billed).
  if v_grade.code is not null then
    v_area := case when v.parent_id is not null then v.area_m2
                   when v.plot_width_m is not null and v.plot_length_m is not null then round(v.plot_width_m * v.plot_length_m, 2)
                   else v.area_m2 end;
    v_tax := round(coalesce(v_area, 0) * v_grade.amount, 2);
    v_valuation := jsonb_build_object('type', v_grade.code, 'type_so', v_grade.name_so, 'type_en', v_grade.name_en,
                                      'floors', v.floors, 'area_m2', v_area, 'rate_m2', v_grade.amount, 'tax', v_tax);
  end if;

  -- Which certificate of this land this is, and the one before it.
  select count(*) + 1 into v_seq from public.issued_documents
   where parcel_id = p_parcel and type = 'certificate' and status <> 'cancelled';
  select * into v_prev from public.issued_documents
   where parcel_id = p_parcel and type = 'certificate'
   order by (status <> 'cancelled') desc, issued_at desc limit 1;

  if v_prev.id is not null then
    if (select coalesce(array_agg(o ->> 'party_id' order by o ->> 'party_id'), '{}') from jsonb_array_elements(v_prev.snapshot -> 'owners') o)
       is distinct from
       (select coalesce(array_agg(po.party_id::text order by po.party_id::text), '{}') from public.parcel_owners po where po.parcel_id = p_parcel and po.valid_to is null) then
      v_changes := v_changes || 'owners'::text;
    end if;
    if (v_prev.snapshot ->> 'area_m2')::numeric is distinct from v.area_m2 then
      v_changes := v_changes || 'area'::text;
    end if;
    if v_prev.snapshot ->> 'land_use' is distinct from v.land_use::text then
      v_changes := v_changes || 'land_use'::text;
    end if;
    if v_prev.snapshot ? 'valuation' and v_valuation is not null
       and ((v_prev.snapshot -> 'valuation' ->> 'type') is distinct from (v_valuation ->> 'type')
            or (v_prev.snapshot -> 'valuation' ->> 'floors') is distinct from (v_valuation ->> 'floors')) then
      v_changes := v_changes || 'building'::text;
    end if;
  end if;

  return jsonb_build_object(
    'tax_year', p_year,
    'valid_from', make_date(p_year, 1, 1),
    'valid_to', make_date(p_year, 12, 31),
    'bills', v_bills,
    'receipts', v_receipts,
    'paid_in_full', jsonb_array_length(v_bills) > 0
                    and not exists (select 1 from jsonb_array_elements(v_bills) b where (b ->> 'balance')::numeric > 0),
    'valuation', v_valuation,
    'sequence', v_seq,
    'previous', case when v_prev.id is not null then jsonb_build_object(
                  'serial', v_prev.serial, 'issued_at', v_prev.issued_at,
                  'tax_year', coalesce((v_prev.snapshot ->> 'tax_year')::int, extract(year from v_prev.issued_at)::int)) end,
    'changes', to_jsonb(v_changes));
end;
$$;
revoke all on function private.certificate_year_facts(uuid, int) from public;

/** Marks certificates (and ID cards) past their end date as expired: all of them, or one land's. */
create or replace function private.documents_expire(p_parcel uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.issued_documents set status = 'expired'
   where status = 'valid' and expires_at is not null and expires_at < current_date
     and (p_parcel is null or parcel_id = p_parcel);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.documents_expire(uuid) from public;

-- A certificate is made for this year and ends on 31 December.
create or replace function private.issue_document(p_type document_type, p_parcel uuid, p_party uuid, p_replaces uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.parcels;
  v_snap jsonb;
  v_id uuid;
  v_year int := extract(year from current_date)::int;
  v_prefix text := case when p_type = 'certificate' then 'CERT' else 'IDC' end;
begin
  select * into v_p from public.parcels where id = p_parcel;
  v_snap := private.certificate_snapshot(p_parcel);
  if p_type = 'certificate' then
    v_snap := v_snap || private.certificate_year_facts(p_parcel, v_year);
  end if;
  if p_type = 'id_card' then
    v_snap := v_snap || jsonb_build_object('holder', (select o from jsonb_array_elements(v_snap -> 'owners') o where (o ->> 'party_id')::uuid = p_party));
  end if;
  insert into public.issued_documents (type, serial, verify_code, parcel_id, party_id, district_id, snapshot, issued_by, expires_at, replaces_id)
  values (p_type, v_prefix || '-' || v_year || '-' || lpad(private.next_serial(v_prefix || '-' || v_year)::text, 6, '0'),
          private.new_verify_code(), p_parcel, p_party, v_p.district_id, v_snap, auth.uid(),
          case when p_type = 'id_card' then (current_date + make_interval(years => private.setting_int('certificates.id_card_years', 5)))::date
               else make_date(v_year, 12, 31) end,
          p_replaces)
  returning id into v_id;
  perform private.parcel_event(p_parcel, p_type::text || '_issued', null, jsonb_build_object('document_id', v_id));
  return v_id;
end;
$$;

-- Last year's certificate no longer stops this year's from being issued.
create or replace function public.certificate_issue(p_parcel uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_blockers text[];
  v_cert uuid;
  v_cards int := 0;
  r record;
begin
  perform private.assert_permission('certificates.approve');
  select * into v from public.parcels where id = p_parcel and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  perform private.documents_expire(p_parcel);
  v_blockers := private.certificate_blockers(p_parcel);
  if cardinality(v_blockers) > 0 then
    perform private.raise_app_error('CONFLICT', 'not_eligible:' || array_to_string(v_blockers, ','));
  end if;
  if exists (select 1 from public.issued_documents where parcel_id = p_parcel and type = 'certificate' and status = 'valid') then
    perform private.raise_app_error('CONFLICT', 'already_issued');
  end if;
  v_cert := private.issue_document('certificate', p_parcel, null, null);
  for r in select po.party_id from public.parcel_owners po where po.parcel_id = p_parcel and po.valid_to is null
           and not exists (select 1 from public.issued_documents d where d.parcel_id = p_parcel and d.party_id = po.party_id and d.type = 'id_card' and d.status = 'valid') loop
    perform private.issue_document('id_card', p_parcel, r.party_id, null);
    v_cards := v_cards + 1;
  end loop;
  return jsonb_build_object('certificate_id', v_cert, 'id_cards', v_cards);
end;
$$;

create or replace function private.try_auto_certificate(p_parcel uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert uuid;
  v public.parcels;
  r record;
begin
  perform private.documents_expire(p_parcel);
  if cardinality(private.certificate_blockers(p_parcel)) > 0
     or exists (select 1 from public.issued_documents where parcel_id = p_parcel and type = 'certificate' and status = 'valid') then
    return null;
  end if;
  v_cert := private.issue_document('certificate', p_parcel, null, null);
  for r in select po.party_id from public.parcel_owners po where po.parcel_id = p_parcel and po.valid_to is null
           and not exists (select 1 from public.issued_documents d where d.parcel_id = p_parcel and d.party_id = po.party_id
                           and d.type = 'id_card' and d.status = 'valid') loop
    perform private.issue_document('id_card', p_parcel, r.party_id, null);
  end loop;
  perform private.parcel_event(p_parcel, 'certificate_auto_issued', 'Paid in full', jsonb_build_object('document_id', v_cert));

  -- Paid and approved: tell the registrar who registered it and the district's print officers.
  select * into v from public.parcels where id = p_parcel;
  for r in
    select distinct p.user_id from public.profiles p
     where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
       and not private.user_grants_all(p.user_id)
       and private.user_can_access_district(p.user_id, v.district_id)
       and (p.user_id = v.registered_by or private.user_has_permission(p.user_id, 'certificates.print'))
  loop
    perform private.notify(r.user_id, 'parcel.paid',
      v.pun || ' waa la bixiyay — shahaadada daabac', v.pun || ' is paid — certificate ready to print',
      '/parcels/' || p_parcel);
  end loop;
  return v_cert;
end;
$$;

/** 1 January: last year's certificates expire; land with nothing left to pay gets this year's straight away. */
create or replace function private.certificates_new_year()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired int;
  v_issued int := 0;
  r record;
begin
  v_expired := private.documents_expire(null);
  for r in
    select p.id from public.parcels p
     where p.deleted_at is null and p.status = 'registered' and p.layout = 'house' and p.building_state is distinct from 'demolished'
       and exists (select 1 from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status = 'expired')
       and not exists (select 1 from public.issued_documents d where d.parcel_id = p.id and d.type = 'certificate' and d.status = 'valid')
  loop
    begin
      if private.try_auto_certificate(r.id) is not null then
        v_issued := v_issued + 1;
      end if;
    exception when others then
      raise warning 'certificates_new_year %: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('expired', v_expired, 'issued', v_issued);
end;
$$;
revoke all on function private.certificates_new_year() from public;

-- After the year's bills are made (billing-auto-year runs at 03:00 on 1 January), and a daily tidy-up of anything past its date.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('certificates-new-year', '0 4 1 1 *', 'select private.certificates_new_year()');
    perform cron.schedule('documents-expire', '20 0 * * *', 'select private.documents_expire(null)');
  end if;
end;
$$;

-- The check page says which year a certificate covers.
create or replace function public.verify_document(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'type', d.type, 'status', case when d.status = 'valid' and d.expires_at is not null and d.expires_at < current_date then 'expired' else d.status::text end,
    'serial', d.serial, 'pun', d.snapshot ->> 'pun', 'issued_at', d.issued_at, 'expires_at', d.expires_at,
    'tax_year', case when d.type = 'certificate' then coalesce((d.snapshot ->> 'tax_year')::int, extract(year from d.issued_at)::int) end,
    'paid_in_full', (d.snapshot -> 'paid_in_full')::boolean,
    'district', d.snapshot -> 'district' ->> 'name_so', 'district_en', d.snapshot -> 'district' ->> 'name_en',
    'neighbourhood', d.snapshot -> 'neighbourhood' ->> 'name_so', 'neighbourhood_en', d.snapshot -> 'neighbourhood' ->> 'name_en',
    'area_m2', d.snapshot -> 'area_m2', 'cancelled_at', d.cancelled_at,
    'owners', (select jsonb_agg(regexp_replace(o ->> 'full_name', '(\S)\S*', '\1.', 'g'))
               from jsonb_array_elements(case when d.type = 'id_card' then jsonb_build_array(d.snapshot -> 'holder') else d.snapshot -> 'owners' end) o))
  from public.issued_documents d
  where d.verify_code = upper(trim(p_code)) and length(trim(p_code)) = 12;
$$;

-- Certificates already out: they cover the year they were issued in, with that year's facts added.
update public.issued_documents d
   set expires_at = make_date(extract(year from d.issued_at)::int, 12, 31),
       snapshot = d.snapshot || (private.certificate_year_facts(d.parcel_id, extract(year from d.issued_at)::int)
                                 - 'sequence' - 'previous' - 'changes')
                 || jsonb_build_object('sequence', (select count(*) from public.issued_documents e
                                                     where e.parcel_id = d.parcel_id and e.type = 'certificate'
                                                       and e.status <> 'cancelled' and e.issued_at < d.issued_at) + 1)
 where d.type = 'certificate' and d.expires_at is null;
