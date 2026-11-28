-- Made-up DEMO flat buildings (owner's request, 2026-11-28): apartments split into flats, each flat with its own owner,
-- phone, owner type and bill, and a building manager. Built through the system's own land_with_units_create and
-- parcel_register (run as a super admin), on free roofs (pin = roof centre). Tagged DEMO like 08_demo_owners.sql;
-- the cashier notifications and SMS jobs these registrations create are removed. Phones +252600 7xxxxx.
-- Run (as a super admin, inside one statement): select private.demo_flats(<district>, <buildings>, <first number>);

create or replace function private.demo_flats(p_district uuid, p_buildings int, p_start int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_m text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Ismaaciil','Abuukar','Siciid','Jaamac','Nuur','Warsame','Bashiir','Khaliif','Mahad','Liibaan','Sahal','Daahir'];
  first_f text[] := array['Faadumo','Caasha','Khadiija','Maryan','Xaawo','Sahra','Hodan','Ifraax','Nimco','Hibaaq','Sucaad','Deeqa','Ubax','Ayaan','Fartuun','Shukri','Hamdi','Naciima','Ruqiya','Zamzam'];
  fathers text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Siciid','Jaamac','Nuur','Warsame','Khaliif','Daahir','Shire','Guuleed','Mire','Samatar','Dirie','Elmi','Roble','Ciise','Barre'];
  t_owner uuid := (select id from public.owner_types where name_en = 'Owner');
  t_family uuid := (select id from public.owner_types where name_en = 'Family / Heirs');
  hoods uuid[];
  roofs bigint[];
  b int;
  f int;
  k int;
  n_flats int;
  v_floors int;
  v_per int;
  v_roof private.building_outlines;
  v_env extensions.geometry;
  a float8;
  c float8;
  v_w numeric;
  v_l numeric;
  v_nb uuid;
  v_house int;
  units jsonb;
  v_no int;
  v_out jsonb;
  v_parent uuid;
  u record;
  i record;
  v_seq int := p_start;
  v_rand float8;
  v_pay numeric;
  n_buildings int := 0;
  n_units int := 0;
  n_paid int := 0;
  v_name text;
  v_g text;
begin
  select array_agg(id order by code) into hoods from public.neighbourhoods where district_id = p_district and deleted_at is null;
  select array_agg(o.id order by md5(o.id::text || 'flats' || p_start::text)) into roofs
    from private.building_outlines o join public.districts d on d.id = p_district
   where o.geom operator(extensions.&&) d.geom and extensions.st_contains(d.geom, o.centre)
     and o.area_m2 between 150 and 900
     and not exists (select 1 from private.parcel_roofs pr where pr.building_id = o.id);

  for b in 1 .. least(p_buildings, coalesce(array_length(roofs, 1), 0)) loop
    select * into v_roof from private.building_outlines where id = roofs[b];
    v_env := extensions.st_orientedenvelope(v_roof.geom);
    a := extensions.st_distance(extensions.st_pointn(extensions.st_exteriorring(v_env), 1)::extensions.geography,
                                extensions.st_pointn(extensions.st_exteriorring(v_env), 2)::extensions.geography);
    c := extensions.st_distance(extensions.st_pointn(extensions.st_exteriorring(v_env), 2)::extensions.geography,
                                extensions.st_pointn(extensions.st_exteriorring(v_env), 3)::extensions.geography);
    v_w := greatest(round(least(a, c)::numeric * 2) / 2, 6);
    v_l := greatest(round(greatest(a, c)::numeric * 2) / 2, 6);
    v_nb := hoods[1 + floor(random() * array_length(hoods, 1))::int];
    select coalesce(max(nullif(regexp_replace(house_no, '\D', '', 'g'), '')::int), 0) + 1 into v_house
      from public.parcels where neighbourhood_id = v_nb and deleted_at is null;
    -- The next number nobody holds (land, applications…), as the land form offers.
    while exists (select 1 from private.house_numbers_in_use(v_nb, null) x where x.house_no = lpad(v_house::text, 2, '0')) loop
      v_house := v_house + 1;
    end loop;
    v_floors := 1 + floor(random() * 3)::int;          -- storeys above the ground floor
    v_per := 1 + floor(random() * 2)::int;             -- flats on each floor
    units := '[]'::jsonb;
    v_no := 0;
    for f in 0 .. v_floors loop
      for k in 1 .. v_per loop
        v_no := v_no + 1;
        v_seq := v_seq + 1;
        v_g := case when random() < 0.62 then 'm' else 'f' end;
        v_name := (case when v_g = 'm' then first_m[1 + floor(random() * array_length(first_m, 1))::int]
                        else first_f[1 + floor(random() * array_length(first_f, 1))::int] end)
                  || ' ' || fathers[1 + floor(random() * array_length(fathers, 1))::int]
                  || ' ' || fathers[1 + floor(random() * array_length(fathers, 1))::int];
        units := units || jsonb_build_array(jsonb_build_object(
          'unit_no', lpad(v_no::text, 2, '0'), 'floor', f,
          'own_m2', round((v_w * v_l * 0.85 / (v_floors + 1) / v_per)::numeric, 1),
          'owner_name', v_name, 'owner_phone', '+2526007' || lpad(v_seq::text, 5, '0'),
          'owner_type_id', case when random() < 0.12 then t_family else t_owner end));
      end loop;
    end loop;
    v_seq := v_seq + 1;
    v_out := public.land_with_units_create(jsonb_build_object(
      'layout', 'flats', 'district_id', p_district, 'neighbourhood_id', v_nb,
      'pin_lon', extensions.st_x(v_roof.centre), 'pin_lat', extensions.st_y(v_roof.centre),
      'plot_width_m', v_w, 'plot_length_m', v_l, 'house_no', lpad(v_house::text, 2, '0'),
      'property_type', 'apartment', 'land_use', 'residential', 'floors', v_floors,
      'manager_name', 'Maamulaha ' || fathers[1 + floor(random() * array_length(fathers, 1))::int] || ' ' || fathers[1 + floor(random() * array_length(fathers, 1))::int],
      'manager_phone', '+2526007' || lpad(v_seq::text, 5, '0'),
      'owner_type_id', t_owner,
      'units', units,
      'geom', extensions.st_asgeojson(v_roof.geom)::jsonb));
    v_parent := (v_out ->> 'parcel_id')::uuid;
    insert into private.parcel_roofs (parcel_id, building_id, moved_m) values (v_parent, v_roof.id, 0);
    update public.parcels set legacy_ref = 'DEMO-F' || lpad(p_start::text, 6, '0') || '-' || b where id = v_parent;
    update public.parcels set legacy_ref = 'DEMO-F' || lpad(p_start::text, 6, '0') || '-' || b || '-' || unit_no where parent_id = v_parent;
    -- The flat owners and the manager are made-up too: tag them before anything is sent.
    update public.parties pa set legacy_id = 'DEMO-F' || substr(pa.phone, 8)
     where pa.id in (select po.party_id from public.parcel_owners po join public.parcels c2 on c2.id = po.parcel_id where c2.parent_id = v_parent)
        or pa.id = (select manager_party_id from public.parcels where id = v_parent);
    n_buildings := n_buildings + 1;

    -- Each flat is registered, then its bills are paid in full, in part or not at all.
    for u in select id from public.parcels where parent_id = v_parent and deleted_at is null order by unit_no loop
      perform public.parcel_register(u.id, null, 'Registered (demo)');
      n_units := n_units + 1;
      for i in select inv.id, inv.balance, inv.issue_date from public.invoices inv where inv.parcel_id = u.id and inv.status in ('issued', 'partially_paid') and inv.balance > 0 loop
        v_rand := random();
        v_pay := case when v_rand < 0.60 then i.balance when v_rand < 0.75 then round((i.balance * (0.3 + random() * 0.5))::numeric, 2) else 0 end;
        if v_pay > 0 then
          perform private.record_payment(jsonb_build_object('parcel_id', u.id, 'invoice_id', i.id, 'amount', v_pay,
            'method', case when v_rand < 0.35 then 'mobile_money' else 'cash' end,
            'wallet', 'evc_plus', 'provider', case when v_rand < 0.35 then 'evc_plus' else 'cash' end,
            'received_at', least(now(), i.issue_date + (random() * 60)::int)::timestamptz));
          n_paid := n_paid + 1;
        end if;
      end loop;
    end loop;
  end loop;

  -- No cashier alerts and no SMS for made-up flats.
  delete from public.notifications nt where nt.kind = 'cashier.to_collect' and nt.created_at = now()
     and exists (select 1 from public.parcels pc where pc.legacy_ref like 'DEMO-F%' and nt.body_en like pc.pun || '%');
  delete from public.jobs j where j.kind like 'sms.%' and j.created_at = now();
  return jsonb_build_object('buildings', n_buildings, 'flats', n_units, 'payments', n_paid, 'next', v_seq + 1);
end;
$$;
revoke all on function private.demo_flats(uuid, int, int) from public, anon, authenticated;
