-- A storey building with one owner (owner's rule, 2026-11-22): the surveyor enters width × length (the area) and how many
-- upper storeys it has (1, 2, 3 …). One invoice: the base (area × the building's price) plus every upper storey
-- (area × the Upper Floors price), all to the one owner. Flats with their own owners keep the units flow.

alter table public.parcels add column if not exists upper_storeys int not null default 0 check (upper_storeys between 0 and 100);

/** The land's area for its upper storeys: width × length, else its recorded area. */
create or replace function private.upper_storeys_area(v public.parcels)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(round(v.plot_width_m * v.plot_length_m, 2), 0), v.area_m2, 0);
$$;

/** The Upper Floors price here (the neighbourhood's own price if it has one), else the building's own price. */
create or replace function private.upper_storeys_grade(v public.parcels)
returns table (name_en text, price numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.property_grades;
begin
  select * into g from public.property_grades where code = 'upper' and active;
  if g.id is null then
    select * into g from public.property_grades where code = v.property_type;
  end if;
  if g.id is null then
    return;
  end if;
  return query select g.name_en, private.grade_price_here(g.id, v.neighbourhood_id, g.amount);
end;
$$;

/** What a land's upper storeys add to its property bill (0 for none, flats and units). */
create or replace function private.upper_storeys_amount(p_parcel uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_price numeric;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.parent_id is not null or v.layout <> 'house' or coalesce(v.upper_storeys, 0) = 0 then
    return 0;
  end if;
  select g.price into v_price from private.upper_storeys_grade(v) g;
  return round(v.upper_storeys * private.upper_storeys_area(v) * coalesce(v_price, 0), 2);
end;
$$;

/** The bill line for the upper storeys, e.g. "2 upper storeys × 600 m² × 0.20 USD per m² (Upper Floors)", or null. */
create or replace function private.upper_storeys_line(p_parcel uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  g record;
begin
  select * into v from public.parcels where id = p_parcel;
  if v.id is null or v.parent_id is not null or v.layout <> 'house' or coalesce(v.upper_storeys, 0) = 0 then
    return null;
  end if;
  select * into g from private.upper_storeys_grade(v) x;
  if g.price is null then
    return null;
  end if;
  return v.upper_storeys || case when v.upper_storeys = 1 then ' upper storey × ' else ' upper storeys × ' end
    || trim(to_char(private.upper_storeys_area(v), 'FM9999990.##')) || ' m² × ' || trim(to_char(g.price, 'FM9999990.00'))
    || ' USD per m² (' || g.name_en || ')';
end;
$$;

revoke all on function private.upper_storeys_area(public.parcels), private.upper_storeys_grade(public.parcels),
  private.upper_storeys_amount(uuid), private.upper_storeys_line(uuid) from public, anon, authenticated;

-- Every place that bills a house adds its upper storeys.
do $do$
declare
  d text;
  n text;
begin
  -- 1. The first bill (when land is saved): the same invoice, one line with both parts.
  d := pg_get_functiondef('private.parcel_bill(uuid)'::regprocedure);
  n := regexp_replace(d, $re$(' USD per m²';)(\s+end if;\s+select \* into v_service)$re$,
    $rp$\1
    v_tax := v_tax + private.upper_storeys_amount(v.id);
    v_line := v_line || coalesce(' + ' || private.upper_storeys_line(v.id), '');\2$rp$);
  if n = d then raise exception 'parcel_bill: anchor not found'; end if;
  execute n;

  -- 2. Re-bill after an edit.
  d := pg_get_functiondef('private.parcel_rebill(uuid)'::regprocedure);
  n := regexp_replace(d, $re$(' USD per m²';)(\s+end if;\s+-- No size)$re$,
    $rp$\1
    if v.parent_id is null then
      v_want := v_want + private.upper_storeys_amount(v.id);
      v_line := v_line || coalesce(' + ' || private.upper_storeys_line(v.id), '');
    end if;\2$rp$);
  if n = d then raise exception 'parcel_rebill: anchor not found'; end if;
  execute n;

  -- 3. The expected bill (missing / wrong bills check).
  d := pg_get_functiondef('private.parcel_bill_expected(uuid)'::regprocedure);
  n := regexp_replace(d, $re$'amount',\s*round\(v_area \* v_grade\.amount, 2\)$re$,
    $rp$'amount', round(v_area * v_grade.amount, 2) + case when v.parent_id is null then private.upper_storeys_amount(v.id) else 0 end, 'upper_storeys', coalesce(v.upper_storeys, 0)$rp$);
  if n = d then raise exception 'parcel_bill_expected: anchor not found'; end if;
  execute n;

  -- 4. The yearly tax run: a second line on the same invoice for the upper storeys.
  d := pg_get_functiondef('private.billing_run_candidates_all(public.billing_runs)'::regprocedure);
  n := regexp_replace(d, $re$p\.registered_at,$re$, $rp$p.registered_at, p.layout as lay,$rp$);
  n := regexp_replace(n, $re$else\s+0\s+end\s+as\s+extras$re$, $rp$else private.upper_storeys_amount(p.id) end as extras$rp$);
  n := regexp_replace(n, $re$'Extra areas ' \|\| p_run\.period \|\| ' \(parking, playgrounds…\)'$re$,
    $rp$case when x.lay = 'flats' then 'Extra areas ' || p_run.period || ' (parking, playgrounds…)' else 'Upper storeys ' || p_run.period || coalesce(' (' || private.upper_storeys_line(x.id) || ')', '') end$rp$);
  if n = d or position('p.layout as lay' in n) = 0 or position('upper_storeys_amount(p.id)' in n) = 0 or position('Upper storeys' in n) = 0 then
    raise exception 'billing_run_candidates_all: anchor not found';
  end if;
  execute n;

  -- 5. A neighbourhood's prices changed: its houses' bills follow, upper storeys included.
  d := pg_get_functiondef('public.neighbourhood_rebill(uuid,uuid[])'::regprocedure);
  n := regexp_replace(d, $re$v_want := round\(v_area \* v_price, 2\);$re$,
    $rp$v_want := round(v_area * v_price, 2) + case when r.layout = 'house' and r.parent_id is null then private.upper_storeys_amount(r.id) else 0 end;$rp$);
  if n = d then raise exception 'neighbourhood_rebill: anchor not found'; end if;
  execute n;

  -- 6. The surveyor's land form saves the number of upper storeys before the first bill is raised.
  d := pg_get_functiondef('public.field_land_create(jsonb)'::regprocedure);
  n := regexp_replace(d, $re$(v_bills := private\.parcel_bill\(v_parcel\);)$re$,
    $rp$if coalesce(nullif(p ->> 'upper_storeys', '')::int, 0) not between 0 and 100 then
    perform private.raise_app_error('VALIDATION', 'upper_storeys');
  end if;
  update public.parcels set upper_storeys = coalesce(nullif(p ->> 'upper_storeys', '')::int, 0) where id = v_parcel;
  \1$rp$);
  if n = d then raise exception 'field_land_create: anchor not found'; end if;
  execute n;
end;
$do$;
