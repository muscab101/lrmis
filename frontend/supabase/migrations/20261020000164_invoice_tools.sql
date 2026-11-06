-- Two tools on the Invoices page. Duplicates: the same bill raised twice for one parcel; one stays and the others are
-- cancelled, which keeps them on record. Missing: a bill a parcel should have and doesn't, because it was cancelled or
-- never raised; it is raised again the same way as when the land was saved. Demolished land is left alone.

/** The bills this could be: same parcel, same kind and same year. Land registered again starts fresh, as it has a new house. */
create function public.invoice_duplicates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_permission('invoices.cancel');
  with bills as (
    select i.id, i.number, i.total, i.paid, i.credited, i.created_at, i.parcel_id, p.pun, f.name_so, f.name_en,
           row_number() over (w order by (i.paid > 0 or i.credited > 0) desc, i.created_at, i.number) as place, count(*) over w as copies,
           (i.paid > 0 or i.credited > 0) as has_money
      from public.invoices i
      join public.parcels p on p.id = i.parcel_id
      join public.fee_types f on f.id = i.fee_type_id
     where i.status <> 'cancelled' and p.deleted_at is null and p.building_state = 'standing'
       and f.code in ('property_bill', 'service_charge', 'property_tax')
       and public.can_access_district(i.district_id)
    window w as (partition by i.parcel_id, f.id, extract(year from i.issue_date),
                   (select count(*) from public.demolitions d where d.parcel_id = i.parcel_id and d.rebuilt_at <= i.created_at))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'number', b.number, 'total', b.total, 'paid', b.paid, 'pun', b.pun,
           'parcel_id', b.parcel_id, 'fee_so', b.name_so, 'fee_en', b.name_en, 'keep', b.place = 1,
           'has_money', b.has_money) order by b.pun, b.name_en, b.place), '[]'::jsonb)
    into v from bills b where b.copies > 1;
  return v;
end;
$$;

/** Keeps one of each and cancels the others. A copy with money on it is never cancelled. */
create function public.invoice_duplicates_fix()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_done int := 0;
  v_left int := 0;
begin
  perform private.assert_permission('invoices.cancel');
  for r in select value from jsonb_array_elements(public.invoice_duplicates()) loop
    if (r ->> 'keep')::boolean then
      continue;
    end if;
    if (r ->> 'has_money')::boolean then
      v_left := v_left + 1;
      continue;
    end if;
    update public.invoices set status = 'cancelled', cancel_reason = 'Duplicate bill removed' where id = (r ->> 'id')::uuid and status <> 'cancelled';
    perform private.parcel_event((r ->> 'parcel_id')::uuid, 'invoice_cancelled', 'Duplicate bill removed', jsonb_build_object('invoice_id', r ->> 'id'));
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('cancelled', v_done, 'left', v_left);
end;
$$;

/** What a parcel should be billed and isn't: its tax bill from its size and type, and the service charge. */
create function public.invoice_missing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_permission('invoices.create');
  with lands as (
    select p.id, p.pun, p.house_no, p.status,
           coalesce(g.amount, 0) as price,
           case when p.parent_id is not null then p.area_m2 else round(p.plot_width_m * p.plot_length_m, 2) end as area,
           (select string_agg(pa.full_name, ', ') from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = p.id and po.valid_to is null) as owners
      from public.parcels p
      left join public.property_grades g on g.code = p.property_type
     where p.deleted_at is null and p.layout = 'house' and p.building_state = 'standing'
       and p.status in ('draft', 'surveyed', 'verified', 'registered', 'disputed')
       and public.can_access_district(p.district_id)
  ), wanted as (
    select l.*, 'property_bill' as code, round(l.area * l.price, 2) as amount from lands l where l.price > 0 and coalesce(l.area, 0) > 0
    union all
    select l.*, 'service_charge', round(s.amount, 2) from lands l, public.fee_types s where s.code = 'service_charge' and s.active and coalesce(s.amount, 0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('parcel_id', w.id, 'pun', w.pun, 'house_no', w.house_no, 'owners', w.owners, 'code', w.code,
           'fee_so', f.name_so, 'fee_en', f.name_en, 'amount', w.amount) order by w.pun, w.code), '[]'::jsonb)
    into v
    from wanted w
    join public.fee_types f on f.code = w.code
   where not exists (select 1 from public.invoices i join public.fee_types x on x.id = i.fee_type_id
                      where i.parcel_id = w.id and i.status <> 'cancelled'
                        and (x.code = w.code or (w.code = 'property_bill' and x.code = 'property_tax')));
  return v;
end;
$$;

/** Raises the missing bills of these parcels, each as one bill. */
create function public.invoice_missing_create(p_parcels uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_done int := 0;
begin
  perform private.assert_permission('invoices.create');
  for v_id in
    select distinct (x ->> 'parcel_id')::uuid from jsonb_array_elements(public.invoice_missing()) x
     where (x ->> 'parcel_id')::uuid = any (p_parcels)
  loop
    v_done := v_done + private.parcel_bill(v_id);
  end loop;
  return v_done;
end;
$$;

revoke all on function public.invoice_duplicates(), public.invoice_duplicates_fix(), public.invoice_missing(), public.invoice_missing_create(uuid[]) from public, anon;
grant execute on function public.invoice_duplicates(), public.invoice_duplicates_fix(), public.invoice_missing(), public.invoice_missing_create(uuid[]) to authenticated;
