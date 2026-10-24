-- When registered land is paid in full the system approves it (issues the certificate and the owners' ID cards, as
-- before) and now also says so: the registrar who registered it and the district's print officers are told
-- "<PUN> is paid — certificate ready to print".

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
revoke all on function private.try_auto_certificate(uuid) from public, anon, authenticated;
