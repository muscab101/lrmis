-- The certificate's security watermark prints the issue date, owner names and phones, house number,
-- the tax bill number, neighbourhood and district. Freeze the three that weren't in the snapshot yet:
-- house_no, invoice_no (the parcel's first tax bill, else its first bill) and each owner's phone.

create or replace function private.certificate_snapshot(p_parcel uuid)
returns jsonb
language sql
stable
security definer
set search_path = extensions
as $$
  select jsonb_build_object(
    'pun', p.pun, 'account_no', p.account_no, 'area_m2', p.area_m2, 'perimeter_m', p.perimeter_m,
    'land_use', p.land_use, 'ownership', p.ownership, 'plot_no', p.plot_no, 'deed_no', p.deed_no,
    'house_no', p.house_no,
    'invoice_no', (select i.number from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = p.id and i.status <> 'cancelled'
                    order by (ft.code = 'property_bill') desc, i.issue_date, i.number limit 1),
    'registered_at', p.registered_at,
    'district', jsonb_build_object('code', d.code, 'name_so', d.name_so, 'name_en', d.name_en),
    'neighbourhood', jsonb_build_object('code', n.code, 'name_so', n.name_so, 'name_en', n.name_en),
    'centroid', jsonb_build_array(round(st_x(p.centroid)::numeric, 6), round(st_y(p.centroid)::numeric, 6)),
    'geom', st_asgeojson(p.geom, 7)::jsonb,
    'neighbours', coalesce((select s.neighbours from public.surveys s where s.parcel_id = p.id and s.status = 'submitted' order by s.submitted_at desc nulls last limit 1), '{}'::jsonb),
    'adjacent', coalesce((select jsonb_agg(jsonb_build_object('pun', q.pun, 'geom', st_asgeojson(q.geom, 7)::jsonb))
                          from public.parcels q where q.id <> p.id and q.deleted_at is null and st_dwithin(q.geom::geography, p.geom::geography, 30)), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('party_id', pa.id, 'full_name', pa.full_name, 'mother_name', pa.mother_name,
                                                           'id_type', pa.id_type, 'id_number', pa.id_number, 'role', po.role, 'share_pct', po.share_pct,
                                                           'photo_path', pa.photo_path, 'phone', pa.phone) order by po.share_pct desc nulls last, pa.full_name)
                        from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                        where po.parcel_id = p.id and po.valid_to is null), '[]'::jsonb),
    'registrar', (select pr.full_name from public.profiles pr where pr.user_id = auth.uid()))
  from public.parcels p
  join public.districts d on d.id = p.district_id
  left join public.neighbourhoods n on n.id = p.neighbourhood_id
  where p.id = p_parcel;
$$;

/**
 * Watermark facts for documents issued before 0065 froze them: house number, first tax bill and owner
 * phones from today's register. Same access rule as reading the document.
 */
create or replace function public.document_watermark_facts(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.issued_documents;
begin
  select * into v from public.issued_documents where id = p_id;
  if v.id is null or not private.can_view_document(v.district_id, v.parcel_id) then
    perform private.raise_app_error('NOT_FOUND', 'document');
  end if;
  return jsonb_build_object(
    'house_no', (select house_no from public.parcels where id = v.parcel_id),
    'invoice_no', (select i.number from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                    where i.parcel_id = v.parcel_id and i.status <> 'cancelled'
                    order by (ft.code = 'property_bill') desc, i.issue_date, i.number limit 1),
    'phones', coalesce((select jsonb_object_agg(pa.id, pa.phone) from public.parties pa
                         where pa.id in (select (o ->> 'party_id')::uuid from jsonb_array_elements(coalesce(v.snapshot -> 'owners', '[]')) o)
                           and pa.phone is not null), '{}'::jsonb));
end;
$$;

grant execute on function public.document_watermark_facts(uuid) to authenticated;
revoke execute on function public.document_watermark_facts(uuid) from public, anon;
