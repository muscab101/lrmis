-- Owners with more than one house, and what they owe.
--
-- 1. Same owner, second house: while a surveyor types an owner's name and phone, owners already on the register with
--    the same name and the same phone are offered. "Merge" puts the new house under that owner instead of making a
--    second copy of them. Name and phone must both match, so a shared family phone alone never merges two people.
-- 2. The owner's statement: every house they own, each year's bills, what was paid and what is still owed, so an
--    owner who skipped three years sees the three years, the total, what they paid towards it and what is left.

/** Name compared without case or extra spaces; phone by its last 9 digits (with or without +252 / 0). */
create or replace function private.norm_name(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;
create or replace function private.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '');
$$;

create index if not exists parties_phone_norm_idx on public.parties (private.norm_phone(phone)) where deleted_at is null;

/** Owners already on the register with this same name and phone, with the houses they own. */
create or replace function public.owner_match(p_name text, p_phone text)
returns table (party_id uuid, full_name text, phone text, district_so text, district_en text, houses jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_permission('surveys.create') or public.has_permission('applications.create') or public.has_permission('owners.create')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'owners.create');
  end if;
  if private.norm_name(p_name) is null or length(private.norm_name(p_name)) < 3 or length(coalesce(private.norm_phone(p_phone), '')) < 7 then
    return;
  end if;
  return query
  select pa.id, pa.full_name, pa.phone, d.name_so, d.name_en,
         coalesce((select jsonb_agg(jsonb_build_object('pun', p.pun, 'house_no', p.house_no, 'status', p.status,
                                                       'neighbourhood_so', n.name_so, 'neighbourhood_en', n.name_en) order by p.created_at)
                     from public.parcel_owners po join public.parcels p on p.id = po.parcel_id and p.deleted_at is null
                     left join public.neighbourhoods n on n.id = p.neighbourhood_id
                    where po.party_id = pa.id and po.valid_to is null), '[]'::jsonb)
    from public.parties pa
    left join public.districts d on d.id = pa.district_id
   where pa.deleted_at is null
     and private.norm_phone(pa.phone) = private.norm_phone(p_phone)
     and private.norm_name(pa.full_name) = private.norm_name(p_name)
   order by pa.registered_at nulls last, pa.created_at
   limit 5;
end;
$$;
revoke all on function public.owner_match(text, text) from public, anon;
grant execute on function public.owner_match(text, text) to authenticated;

-- Adding land for a merged owner: an owner from another district is allowed when the name and phone typed match them.
do $do$
declare
  d text := pg_get_functiondef('public.field_land_create(jsonb)'::regprocedure);
  a text := $a$and (pa.district_id is null or public.can_access_district(pa.district_id))) then$a$;
  b text := $b$and (pa.district_id is null or public.can_access_district(pa.district_id)
                          or (private.norm_phone(pa.phone) = private.norm_phone(v_phone)
                              and private.norm_name(pa.full_name) = private.norm_name(v_name)))) then$b$;
begin
  if position(a in d) = 0 then
    raise exception 'field_land_create: owner check not found';
  end if;
  execute replace(d, a, b);
end;
$do$;

/**
 * One owner's bills: their houses, each year's bills (charged, paid, still owed) and their payments.
 * Only land in the districts the viewer can see.
 */
create or replace function public.owner_statement(p_party uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parcels uuid[];
begin
  if not (public.has_permission('invoices.view') or public.has_permission('billing.view') or public.has_permission('payments.view')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'invoices.view');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_parcels
    from public.parcel_owners po join public.parcels p on p.id = po.parcel_id
   where po.party_id = p_party and po.valid_to is null and p.deleted_at is null and public.can_access_district(p.district_id);

  return jsonb_build_object(
    'houses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'pun', p.pun, 'house_no', p.house_no, 'status', p.status, 'share_pct', po.share_pct,
               'neighbourhood_so', n.name_so, 'neighbourhood_en', n.name_en, 'district_so', d.name_so, 'district_en', d.name_en,
               'balance', (select coalesce(sum(i.balance), 0) from public.invoices i where i.parcel_id = p.id and i.status <> 'cancelled'))
             order by p.created_at)
        from public.parcel_owners po join public.parcels p on p.id = po.parcel_id
        join public.districts d on d.id = p.district_id
        left join public.neighbourhoods n on n.id = p.neighbourhood_id
       where po.party_id = p_party and po.valid_to is null and p.id = any (v_parcels)), '[]'::jsonb),
    -- One row per tax year (the billing run's year, else the year the bill was made), each house's bills inside it.
    'years', coalesce((
      select jsonb_agg(y order by (y ->> 'year')::int)
        from (select jsonb_build_object(
                       'year', yr,
                       'charged', sum(i.total), 'paid', sum(i.paid + i.credited), 'balance', sum(i.balance),
                       'bills', jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'pun', p.pun, 'fee_so', ft.name_so, 'fee_en', ft.name_en,
                                                             'total', i.total, 'paid', i.paid + i.credited, 'balance', i.balance, 'status', i.status,
                                                             'due_date', i.due_date) order by p.pun, i.number)) y
                from public.invoices i
                join public.parcels p on p.id = i.parcel_id
                join public.fee_types ft on ft.id = i.fee_type_id
                left join public.billing_runs br on br.id = i.run_id
                cross join lateral (select coalesce(br.year, extract(year from i.issue_date)::int) as yr) x
               where i.parcel_id = any (v_parcels) and i.status <> 'cancelled'
               group by yr) s), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'receipt_no', x.receipt_no, 'at', x.received_at, 'amount', x.amount, 'years', x.years) order by x.received_at desc)
        from (select pm.id, pm.receipt_no, pm.received_at, sum(a.amount) as amount,
                     jsonb_agg(distinct coalesce(br.year, extract(year from i.issue_date)::int)) as years
                from public.payment_allocations a
                join public.payments pm on pm.id = a.payment_id and pm.status = 'completed' and pm.reversed_at is null
                join public.invoices i on i.id = a.invoice_id and i.status <> 'cancelled'
                left join public.billing_runs br on br.id = i.run_id
               where i.parcel_id = any (v_parcels)
               group by pm.id, pm.receipt_no, pm.received_at) x), '[]'::jsonb),
    'totals', (select jsonb_build_object('charged', coalesce(sum(i.total), 0), 'paid', coalesce(sum(i.paid + i.credited), 0),
                                         'balance', coalesce(sum(i.balance), 0))
                 from public.invoices i where i.parcel_id = any (v_parcels) and i.status <> 'cancelled'));
end;
$$;
revoke all on function public.owner_statement(uuid) from public, anon;
grant execute on function public.owner_statement(uuid) to authenticated;
