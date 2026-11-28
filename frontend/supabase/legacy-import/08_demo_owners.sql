-- Made-up DEMO owners for testing (owner's request, 2026-11-28): about 5,100 owners over all 20 districts, each with
-- 1–3 houses (70% one, 20% two, 10% three) on free roofs from private.building_outlines (pin = roof centre, size from the
-- roof), every house type, a 2026 property tax bill each, and payments: ~60% paid in full, ~15% part-paid, ~25% unpaid.
-- Every owner has parties.legacy_id 'DEMO-nnnnnn' and every house parcels.legacy_ref 'DEMO-…' so they can be removed
-- together. Their phones are +252 600 xxxxxx and no message is ever sent to them (migration 0301).
-- Run: select private.demo_generate(<district id>, <owners>, <first number>) for each district; then the SMS jobs the
-- payments queued are removed (see the end of this file).

create or replace function private.demo_generate(p_district uuid, p_owners int, p_start int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_m text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Ismaaciil','Abuukar','Siciid','Jaamac','Nuur','Warsame','Bashiir','Khaliif','Mahad','Liibaan','Sahal','Daahir','Shariif','Cabdullaahi','Cabdiraxmaan','Cabdiqaadir','Mustafe','Yaasiin'];
  first_f text[] := array['Faadumo','Caasha','Khadiija','Maryan','Xaawo','Sahra','Hodan','Ifraax','Nimco','Hibaaq','Sucaad','Deeqa','Ubax','Ayaan','Fartuun','Shukri','Hamdi','Naciima','Ruqiya','Zamzam','Leyla','Asli','Halimo','Fowsiya','Muna'];
  fathers text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Ismaaciil','Abuukar','Siciid','Jaamac','Nuur','Warsame','Khaliif','Daahir','Shire','Guuleed','Hiiraan','Mire','Samatar','Dirie','Elmi','Gacal','Roble','Jimcaale','Ciise','Barre','Haaruun','Qaasim','Sheekh'];
  orgs text[] := array['Shirkadda Hormuud','Shirkadda Dahabshiil','Shirkadda Salaam','Ganacsiga Barwaaqo','Shirkadda Nabad','Ururka Horumarka','Shirkadda Jubba','Ganacsiga Xamar','Shirkadda Daryeel','Shirkadda Bakaaro'];
  grades text[] := array['brick_house','brick_house','brick_house','villa','storey','storey','apartment','apartment','cariish','cariish','baraako','jiingad','warehouse','open_ground'];
  t_owner uuid := (select id from public.owner_types where name_en = 'Owner');
  t_family uuid := (select id from public.owner_types where name_en = 'Family / Heirs');
  t_company uuid := (select id from public.owner_types where name_en = 'Company');
  t_org uuid := (select id from public.owner_types where name_en = 'Organisation');
  v_fee uuid := (select id from public.fee_types where code = 'property_tax');
  v_upper numeric := coalesce((select amount from public.property_grades where code = 'upper'), 0.20);
  hoods uuid[];
  roofs bigint[];
  r_i int := 0;
  i int;
  h int;
  houses int;
  v_party uuid;
  v_parcel uuid;
  v_name text;
  v_kind text;
  v_gender text;
  v_type uuid;
  v_grade public.property_grades;
  v_nb uuid;
  v_roof private.building_outlines;
  v_env extensions.geometry;
  a float8;
  c float8;
  v_w numeric;
  v_l numeric;
  v_storeys int;
  v_ids record;
  v_house int;
  v_reg timestamptz;
  v_price numeric;
  v_tax numeric;
  v_inv uuid;
  v_issue date;
  v_pay numeric;
  v_rand float8;
  n_parcels int := 0;
  n_paid int := 0;
  n_part int := 0;
begin
  select array_agg(id order by code) into hoods from public.neighbourhoods where district_id = p_district and deleted_at is null;
  if hoods is null then
    raise exception 'district % has no neighbourhoods', p_district;
  end if;
  -- Free roofs inside the district, in a fixed shuffled order, the size of a house or building.
  select array_agg(o.id order by md5(o.id::text || p_start::text)) into roofs
    from private.building_outlines o join public.districts d on d.id = p_district
   where o.geom operator(extensions.&&) d.geom and extensions.st_contains(d.geom, o.centre)
     and o.area_m2 between 30 and 1500
     and not exists (select 1 from private.parcel_roofs pr where pr.building_id = o.id);

  for i in 0 .. p_owners - 1 loop
    v_rand := random();
    -- Who: most are people (men and women); some companies and organisations; some families.
    if v_rand < 0.07 then
      v_kind := 'organisation';
      v_name := orgs[1 + floor(random() * array_length(orgs, 1))::int] || ' ' || (p_start + i);
      v_type := case when random() < 0.7 then t_company else t_org end;
      v_gender := null;
    else
      v_kind := 'person';
      v_gender := case when random() < 0.62 then 'male' else 'female' end;
      v_name := (case when v_gender = 'male' then first_m[1 + floor(random() * array_length(first_m, 1))::int]
                      else first_f[1 + floor(random() * array_length(first_f, 1))::int] end)
                || ' ' || fathers[1 + floor(random() * array_length(fathers, 1))::int]
                || ' ' || fathers[1 + floor(random() * array_length(fathers, 1))::int];
      v_type := case when random() < 0.12 then t_family else t_owner end;
    end if;
    insert into public.parties (kind, full_name, gender, nationality, phone, district_id, owner_type_id, legacy_id, registered_at)
    values (v_kind::public.party_kind, v_name, v_gender, 'SO', '+252600' || lpad((p_start + i)::text, 6, '0'), p_district, v_type,
            'DEMO-' || lpad((p_start + i)::text, 6, '0'), now() - (random() * interval '3000 days'))
    returning id into v_party;

    v_rand := random();
    houses := case when v_rand < 0.70 then 1 when v_rand < 0.90 then 2 else 3 end;
    for h in 1 .. houses loop
      r_i := r_i + 1;
      exit when r_i > coalesce(array_length(roofs, 1), 0);
      select * into v_roof from private.building_outlines where id = roofs[r_i];
      v_nb := hoods[1 + floor(random() * array_length(hoods, 1))::int];
      -- Picked once (a random() inside the WHERE would be drawn again for every row).
      v_kind := grades[1 + floor(random() * array_length(grades, 1))::int];
      select * into v_grade from public.property_grades where code = v_kind;
      -- The roof's size: the sides of the smallest rectangle around it.
      v_env := extensions.st_orientedenvelope(v_roof.geom);
      a := extensions.st_distance(extensions.st_pointn(extensions.st_exteriorring(v_env), 1)::extensions.geography,
                                  extensions.st_pointn(extensions.st_exteriorring(v_env), 2)::extensions.geography);
      c := extensions.st_distance(extensions.st_pointn(extensions.st_exteriorring(v_env), 2)::extensions.geography,
                                  extensions.st_pointn(extensions.st_exteriorring(v_env), 3)::extensions.geography);
      v_w := greatest(round(least(a, c)::numeric * 2) / 2, 3);
      v_l := greatest(round(greatest(a, c)::numeric * 2) / 2, 3);
      v_storeys := case v_grade.code when 'storey' then 1 + floor(random() * 4)::int when 'apartment' then 2 + floor(random() * 5)::int else 0 end;
      select coalesce(max(nullif(regexp_replace(house_no, '\D', '', 'g'), '')::int), 0) + 1 into v_house
        from public.parcels where neighbourhood_id = v_nb and deleted_at is null;
      select * into v_ids from private.next_pun(p_district, v_nb);
      v_reg := now() - (random() * interval '3650 days');
      insert into public.parcels (pun, account_no, district_id, neighbourhood_id, house_no, land_use, property_type, ownership,
                                  area_m2, plot_width_m, plot_length_m, upper_storeys, geom, geom_provisional, status, registered_at,
                                  legacy_ref, layout)
      values (v_ids.pun, v_ids.account_no, p_district, v_nb, lpad(v_house::text, 2, '0'),
              (case when random() < 0.12 then 'commercial' else 'residential' end)::public.land_use, v_grade.code, 'private',
              round((v_w * v_l)::numeric, 2), v_w, v_l, v_storeys, v_roof.geom, false, 'registered', v_reg,
              'DEMO-' || lpad((p_start + i)::text, 6, '0') || '-' || h, 'house')
      returning id into v_parcel;
      insert into private.parcel_roofs (parcel_id, building_id, moved_m) values (v_parcel, v_roof.id, 0);
      insert into public.parcel_owners (parcel_id, party_id, role, share_pct, valid_from)
      values (v_parcel, v_party, 'owner', 100, v_reg::date);
      n_parcels := n_parcels + 1;

      -- The 2026 property tax bill: size × the house type's price here, plus each upper storey × size × Upper Floors.
      v_price := private.grade_price_here(v_grade.id, v_nb, v_grade.amount);
      v_tax := round(v_w * v_l * v_price + v_storeys * v_w * v_l * v_upper, 2);
      if v_tax > 0 then
        v_issue := date '2026-01-05' + floor(random() * 300)::int;
        insert into public.invoices (number, parcel_id, district_id, fee_type_id, period, issue_date, due_date, total, note)
        values (private.invoice_number(2026), v_parcel, p_district, v_fee, '2026', v_issue, v_issue + 60, v_tax, 'Property tax 2026')
        returning id into v_inv;
        insert into public.invoice_lines (invoice_id, kind, description, amount)
        values (v_inv, 'tax', v_grade.name_en || ': ' || trim(to_char(v_w, 'FM9999990.##'), '.') || ' m × ' || trim(to_char(v_l, 'FM9999990.##'), '.') || ' m'
                       || case when v_storeys > 0 then ' + ' || v_storeys || ' upper storeys' else '' end, v_tax);
        -- Paid in full, part-paid or not at all.
        v_rand := random();
        v_pay := case when v_rand < 0.60 then v_tax when v_rand < 0.75 then round((v_tax * (0.3 + random() * 0.5))::numeric, 2) else 0 end;
        if v_pay > 0 then
          perform private.record_payment(jsonb_build_object(
            'parcel_id', v_parcel, 'invoice_id', v_inv, 'amount', v_pay,
            'method', case when (v_issue - date '2026-01-01') % 20 < 11 then 'mobile_money' else 'cash' end,
            'wallet', (array['evc_plus', 'edahab', 'zaad'])[1 + (v_issue - date '2026-01-01') % 3],
            'provider', case when (v_issue - date '2026-01-01') % 20 < 11 then (array['evc_plus', 'edahab', 'zaad'])[1 + (v_issue - date '2026-01-01') % 3] else 'cash' end,
            'received_at', least(now(), v_issue + (random() * 120)::int)::timestamptz,
            'payer_name', v_name));
          if v_pay >= v_tax then n_paid := n_paid + 1; else n_part := n_part + 1; end if;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('owners', p_owners, 'houses', n_parcels, 'paid', n_paid, 'part_paid', n_part, 'roofs_left', coalesce(array_length(roofs, 1), 0) - r_i);
end;
$$;
revoke all on function private.demo_generate(uuid, int, int) from public, anon, authenticated;

-- After generating: no SMS jobs for made-up payments.
-- delete from public.jobs where kind = 'sms.receipt' and (payload ->> 'payment_id')::uuid in (
--   select pm.id from public.payments pm join public.parcels pc on pc.id = pm.parcel_id where pc.legacy_ref like 'DEMO-%');
