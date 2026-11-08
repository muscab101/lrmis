-- More reports, so every part of the registry has one: transfers, building permits, disputes, demolished houses,
-- survey zones (field progress), this year's certificates (who has one, who still owes), staff work and SMS sent.
-- Same rules as the other reports: `reports.view`, only the districts the person covers, and the area filter.
-- Staff work also needs `audit.view` (it shows what each person did).

-- Transfers started or decided in the period.
create or replace function public.report_transfers(p_from date, p_to date, p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (transfer_id uuid, parcel_id uuid, number text, pun text, kind text, from_owners text, to_owners text,
               declared_value numeric, district_so text, district_en text, created_at timestamptz, decided_at timestamptz,
               decided_by text, status text, duty_balance numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select t.id, p.id, t.number, p.pun, t.kind::text,
           (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(coalesce(t.from_owners, '[]'::jsonb)) o),
           (select string_agg(o ->> 'full_name', ', ') from jsonb_array_elements(coalesce(t.to_owners, '[]'::jsonb)) o),
           t.declared_value, d.name_so, d.name_en, t.created_at, t.decided_at, pr.full_name, t.status::text,
           (select i.balance from public.invoices i where i.id = t.duty_invoice_id)
      from public.transfers t
      join public.districts d on d.id = t.district_id
      left join public.parcels p on p.id = t.parcel_id
      left join public.profiles pr on pr.user_id = t.decided_by
     where coalesce(t.decided_at, t.submitted_at, t.created_at) >= p_from
       and coalesce(t.decided_at, t.submitted_at, t.created_at) < p_to + 1
       and public.can_access_district(t.district_id)
       and (p_district is null or t.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by t.created_at desc
     limit 10000;
end;
$$;

-- Building permits asked for or decided in the period.
create or replace function public.report_permits(p_from date, p_to date, p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (permit_id uuid, parcel_id uuid, number text, pun text, kind text, applicant text, phone text,
               floors int, area_m2 numeric, district_so text, district_en text, requested_at timestamptz,
               decided_at timestamptz, decided_by text, status text, valid_until date)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select pm.id, p.id, pm.number, p.pun, pm.kind::text, pm.applicant_name, pm.applicant_phone, pm.floors, pm.area_m2,
           d.name_so, d.name_en, pm.requested_at, pm.decided_at, pr.full_name, pm.status::text, pm.valid_until
      from public.permits pm
      join public.districts d on d.id = pm.district_id
      left join public.parcels p on p.id = pm.parcel_id
      left join public.profiles pr on pr.user_id = pm.decided_by
     where coalesce(pm.decided_at, pm.requested_at) >= p_from and coalesce(pm.decided_at, pm.requested_at) < p_to + 1
       and public.can_access_district(pm.district_id)
       and (p_district is null or pm.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by pm.requested_at desc
     limit 10000;
end;
$$;

-- Disputes opened in the period, and every one still open.
create or replace function public.report_disputes(p_from date, p_to date, p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (dispute_id uuid, parcel_id uuid, number text, pun text, kind text, claimant text, court_case_no text,
               district_so text, district_en text, opened_at timestamptz, resolved_at timestamptz, days_open int,
               status text, resolution text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select x.id, p.id, x.number, p.pun, x.kind::text, x.claimant_name, x.court_case_no, d.name_so, d.name_en,
           x.opened_at, x.resolved_at, (coalesce(x.resolved_at, now())::date - x.opened_at::date)::int,
           x.status::text, x.resolution
      from public.disputes x
      join public.districts d on d.id = x.district_id
      left join public.parcels p on p.id = x.parcel_id
     where ((x.opened_at >= p_from and x.opened_at < p_to + 1) or x.status = 'open')
       and public.can_access_district(x.district_id)
       and (p_district is null or x.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by x.status = 'open' desc, x.opened_at desc
     limit 10000;
end;
$$;

-- Houses demolished in the period (by the demolition date), and whether they were rebuilt or restored.
create or replace function public.report_demolished(p_from date, p_to date, p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (demolition_id uuid, parcel_id uuid, number text, pun text, house_no text, owners text,
               district_so text, district_en text, neighbourhood_so text, neighbourhood_en text,
               demolition_date date, reason text, status text, rebuilt boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select dm.id, dm.parcel_id, dm.number, dm.pun, dm.house_no, dm.owner_names, d.name_so, d.name_en,
           n.name_so, n.name_en, coalesce(dm.demolition_date, dm.requested_at::date), dm.reason, dm.status,
           dm.rebuilt_at is not null
      from public.demolitions dm
      join public.districts d on d.id = dm.district_id
      left join public.neighbourhoods n on n.id = dm.neighbourhood_id
     where coalesce(dm.demolition_date, dm.requested_at::date) between p_from and p_to
       and public.can_access_district(dm.district_id)
       and (p_district is null or dm.district_id = p_district)
       and private.in_area(dm.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by coalesce(dm.demolition_date, dm.requested_at::date) desc
     limit 10000;
end;
$$;

-- Survey zones now: who has each one, how many houses are recorded against the target, and how many owners wait for land.
create or replace function public.report_survey_zones(p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (zone_id uuid, code text, name_so text, name_en text, district_so text, district_en text, surveyor text,
               target int, recorded bigint, partial bigint, registered bigint, pct numeric, owners_waiting bigint,
               assigned_at timestamptz, status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select q.id, q.code, q.name_so, q.name_en, q.dso, q.den, q.full_name, q.tgt, q.rec, q.part, q.reg,
           round(least(100, q.rec * 100.0 / nullif(q.tgt, 0)), 1),
           (select count(*) from public.parties pa
             where pa.deleted_at is null and pa.created_by = q.surveyor_id and pa.created_at >= q.assigned
               and (pa.district_id is null or pa.district_id = q.district_id)
               and not exists (select 1 from public.parcel_owners po where po.party_id = pa.id)
               and not exists (select 1 from public.application_parties ap where ap.party_id = pa.id)),
           q.assigned, q.st
      from (
        select z.id, n.code, n.name_so, n.name_en, d.name_so as dso, d.name_en as den, sp.full_name, z.target as tgt,
               (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status <> 'archived') as rec,
               (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('draft', 'surveyed', 'verified')),
               (select count(*) from public.parcels p where p.neighbourhood_id = n.id and p.parent_id is null and p.deleted_at is null and p.status in ('registered', 'disputed')),
               z.surveyor_id, z.district_id, z.assigned_at as assigned, z.status as st
          from public.survey_zones z
          join public.neighbourhoods n on n.id = z.neighbourhood_id
          join public.districts d on d.id = z.district_id
          left join public.profiles sp on sp.user_id = z.surveyor_id
         where public.can_access_district(z.district_id)
           and (p_district is null or z.district_id = p_district)
           and private.in_area(n.id, p_section, p_sector, p_neighbourhood)
      ) q (id, code, name_so, name_en, dso, den, full_name, tgt, rec, part, reg, surveyor_id, district_id, assigned, st)
     order by q.st = 'open' desc, q.assigned desc
     limit 1000;
end;
$$;

-- Every registered house and this year's certificate: valid, expired, cancelled or none yet, and what it still owes.
create or replace function public.report_certificate_status(p_district uuid default null,
  p_section uuid default null, p_sector uuid default null, p_neighbourhood uuid default null)
returns table (parcel_id uuid, pun text, owner text, phone text, district_so text, district_en text,
               neighbourhood_so text, neighbourhood_en text, serial text, issued_at timestamptz, expires_at date,
               cert_status text, owing numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(current_date, current_date);
  return query
    select p.id, p.pun,
           (select string_agg(op.full_name, ', ' order by o.share_pct desc nulls last, op.full_name)
              from public.parcel_owners o join public.parties op on op.id = o.party_id
             where o.parcel_id = p.id and o.valid_to is null and o.role in ('owner', 'co_owner', 'heir')),
           (select op.phone from public.parcel_owners o join public.parties op on op.id = o.party_id
             where o.parcel_id = p.id and o.valid_to is null and o.role in ('owner', 'co_owner', 'heir') and op.phone is not null
             order by o.share_pct desc nulls last limit 1),
           d.name_so, d.name_en, n.name_so, n.name_en, c.serial, c.issued_at, c.expires_at,
           case when c.id is null then 'none'
                when c.status = 'valid' and (c.expires_at is null or c.expires_at >= current_date) then 'valid'
                when c.status = 'cancelled' then 'cancelled'
                else 'expired' end,
           coalesce((select sum(i.balance) from public.invoices i
                      where i.parcel_id = p.id and i.status in ('issued', 'partially_paid') and i.balance > 0), 0)
      from public.parcels p
      join public.districts d on d.id = p.district_id
      left join public.neighbourhoods n on n.id = p.neighbourhood_id
      left join lateral (
        select doc.id, doc.serial, doc.issued_at, doc.expires_at, doc.status
          from public.issued_documents doc
         where doc.parcel_id = p.id and doc.type = 'certificate'
         order by doc.issued_at desc limit 1) c on true
     where p.status in ('registered', 'disputed') and p.deleted_at is null and p.parent_id is null
       and public.can_access_district(p.district_id)
       and (p_district is null or p.district_id = p_district)
       and private.in_area(p.neighbourhood_id, p_section, p_sector, p_neighbourhood)
     order by (c.id is not null and c.status = 'valid' and (c.expires_at is null or c.expires_at >= current_date)), p.pun
     limit 10000;
end;
$$;

-- What each staff member did in the period: land added and registered, payments taken, certificates issued,
-- transfers / permits decided, and every change they saved.
create or replace function public.report_staff_activity(p_from date, p_to date, p_district uuid default null)
returns table (user_id uuid, staff text, role text, parcels_added bigint, parcels_registered bigint, payments bigint,
               payments_amount numeric, certificates bigint, decisions bigint, changes bigint, last_active timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  if not public.has_permission('audit.view') then
    perform private.raise_app_error('PERMISSION_DENIED', 'audit.view');
  end if;
  return query
    with s as (
      select pr.user_id, pr.full_name,
             (select string_agg(distinct r.name_en, ', ') from public.user_roles ur join public.roles r on r.id = ur.role_id
               where ur.user_id = pr.user_id) as role_names
        from public.profiles pr
       where p_district is null
          or exists (select 1 from public.user_districts ud where ud.user_id = pr.user_id and ud.district_id = p_district)
    ), x as (
      select s.user_id, s.full_name, s.role_names,
             (select count(*) from public.parcels p where p.created_by = s.user_id and p.created_at >= p_from and p.created_at < p_to + 1
                 and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)) as added,
             (select count(*) from public.parcels p where p.registered_by = s.user_id and p.registered_at >= p_from and p.registered_at < p_to + 1
                 and public.can_access_district(p.district_id) and (p_district is null or p.district_id = p_district)) as reg,
             (select count(*) from public.payments y where y.created_by = s.user_id and y.received_at >= p_from and y.received_at < p_to + 1
                 and y.reversed_at is null and public.can_access_district(y.district_id) and (p_district is null or y.district_id = p_district)) as pays,
             (select coalesce(sum(y.amount_base), 0) from public.payments y where y.created_by = s.user_id and y.received_at >= p_from and y.received_at < p_to + 1
                 and y.reversed_at is null and public.can_access_district(y.district_id) and (p_district is null or y.district_id = p_district)) as pay_amt,
             (select count(*) from public.issued_documents doc where doc.issued_by = s.user_id and doc.issued_at >= p_from and doc.issued_at < p_to + 1
                 and (doc.district_id is null or public.can_access_district(doc.district_id)) and (p_district is null or doc.district_id = p_district)) as certs,
             (select count(*) from public.transfers t where t.decided_by = s.user_id and t.decided_at >= p_from and t.decided_at < p_to + 1
                 and public.can_access_district(t.district_id) and (p_district is null or t.district_id = p_district))
               + (select count(*) from public.permits pm where pm.decided_by = s.user_id and pm.decided_at >= p_from and pm.decided_at < p_to + 1
                 and public.can_access_district(pm.district_id) and (p_district is null or pm.district_id = p_district)) as dec,
             (select count(*) from public.audit_log a where a.actor_id = s.user_id and a.at >= p_from and a.at < p_to + 1) as chg,
             (select max(a.at) from public.audit_log a where a.actor_id = s.user_id and a.at < p_to + 1) as last_at
        from s
    )
    select x.user_id, x.full_name, x.role_names, x.added, x.reg, x.pays, x.pay_amt, x.certs, x.dec, x.chg, x.last_at
      from x
     where x.added + x.reg + x.pays + x.certs + x.dec + x.chg > 0
     order by x.chg desc, x.full_name
     limit 1000;
end;
$$;

-- Messages (SMS, WhatsApp, email) in the period by kind: how many went, failed, wait or were stopped.
create or replace function public.report_messages(p_from date, p_to date, p_district uuid default null)
returns table (template_code text, channel text, total bigint, sent bigint, waiting bigint, failed bigint, cancelled bigint, rate numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_report(p_from, p_to);
  return query
    select coalesce(m.template_code, 'other'), m.channel::text, count(*),
           count(*) filter (where m.status = 'sent'),
           count(*) filter (where m.status in ('queued', 'sending')),
           count(*) filter (where m.status = 'failed'),
           count(*) filter (where m.status = 'cancelled'),
           round(count(*) filter (where m.status = 'sent') * 100.0 / nullif(count(*) filter (where m.status <> 'cancelled'), 0), 1)
      from public.messages m
     where m.created_at >= p_from and m.created_at < p_to + 1
       and (m.district_id is null or public.can_access_district(m.district_id))
       and (p_district is null or m.district_id = p_district)
     group by 1, 2
     order by count(*) desc;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'report_transfers(date, date, uuid, uuid, uuid, uuid)', 'report_permits(date, date, uuid, uuid, uuid, uuid)',
    'report_disputes(date, date, uuid, uuid, uuid, uuid)', 'report_demolished(date, date, uuid, uuid, uuid, uuid)',
    'report_survey_zones(uuid, uuid, uuid, uuid)', 'report_certificate_status(uuid, uuid, uuid, uuid)',
    'report_staff_activity(date, date, uuid)', 'report_messages(date, date, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
