-- The back of an ID card needs the district outlines; the print program is not a signed-in person, so they are read directly.
/** The document behind a job being printed, for the page the program opens. The one-time token is the only way in. */
create or replace function public.agent_job_document(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.printer_queue;
  v public.issued_documents;
begin
  select * into v_job from public.printer_queue
   where token_hash = private.printer_key_hash(p_token) and status = 'printing' and claimed_at > now() - interval '15 minutes';
  if v_job.id is null then
    return null;
  end if;
  select * into v from public.issued_documents where id = v_job.document_id;
  return jsonb_build_object(
    'doc', to_jsonb(v) || jsonb_build_object(
      'parcel', (select jsonb_build_object('id', p.id, 'pun', p.pun) from public.parcels p where p.id = v.parcel_id),
      'party', (select jsonb_build_object('full_name', pa.full_name) from public.parties pa where pa.id = v.party_id)),
    'facts', jsonb_build_object(
      'house_no', (select house_no from public.parcels where id = v.parcel_id),
      'invoice_no', (select i.number from public.invoices i join public.fee_types ft on ft.id = i.fee_type_id
                      where i.parcel_id = v.parcel_id and i.status <> 'cancelled'
                      order by (ft.code = 'property_bill') desc, i.issue_date, i.number limit 1),
      'phones', coalesce((select jsonb_object_agg(pa.id, pa.phone) from public.parties pa
                           where pa.id in (select (o ->> 'party_id')::uuid from jsonb_array_elements(coalesce(v.snapshot -> 'owners', '[]')) o)
                             and pa.phone is not null), '{}'::jsonb)),
    'photo_path', (select pa.photo_path from public.parties pa where pa.id = (v.snapshot -> 'holder' ->> 'party_id')::uuid),
    'outlines', case when v.type = 'id_card' then (select jsonb_agg(jsonb_build_object('code', d.code, 'name_so', d.name_so, 'name_en', d.name_en,
                         'outline', extensions.st_asgeojson(extensions.st_simplifypreservetopology(d.geom, 0.0004), 5)::jsonb) order by d.code)
                       from public.districts d where d.deleted_at is null and d.geom is not null) end);
end;
$$;
