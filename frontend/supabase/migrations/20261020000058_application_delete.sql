-- ============================================================================
-- 0058 Delete an application for real (not just cancel it).
--
-- Removes the application with its documents, history and owner links, its
-- draft land (provisional parcel) with that land's unpaid invoices, surveys,
-- notices and history, and its owners — unless an owner also has other land
-- or applications, then the owner is kept.
--
-- Allowed while the application is a draft, awaiting payment, returned,
-- cancelled or rejected, for staff with applications.cancel (in its district)
-- or the applicant. Refused once money was paid on its invoices or its land
-- is registered. The audit log keeps a record of every row removed.
-- ============================================================================

create function public.application_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_parcels uuid[];
  v_invoices uuid[];
  v_surveys uuid[];
  v_parties uuid[];
  v_party uuid;
begin
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if not (v.citizen_user_id = auth.uid()
          or (v.created_by = auth.uid() and v.citizen_user_id is null and not private.caller_is_staff())) then
    perform private.assert_permission('applications.cancel');
  end if;
  if v.status not in ('draft', 'awaiting_payment', 'returned', 'cancelled', 'rejected') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;

  select coalesce(array_agg(id), '{}') into v_parcels from public.parcels
   where id = v.parcel_id or application_id = p_id;
  if exists (select 1 from public.parcels where id = any (v_parcels)
             and (status = 'registered' or registered_at is not null or not geom_provisional)) then
    perform private.raise_app_error('CONFLICT', 'application_land_registered');
  end if;
  select coalesce(array_agg(id), '{}') into v_invoices from public.invoices where parcel_id = any (v_parcels);
  if exists (select 1 from public.payment_allocations where invoice_id = any (v_invoices))
     or exists (select 1 from public.payments where parcel_id = any (v_parcels))
     or exists (select 1 from public.invoices where id = any (v_invoices) and paid > 0) then
    perform private.raise_app_error('CONFLICT', 'application_paid');
  end if;

  -- The owners on it (removed at the end unless they're used elsewhere).
  select coalesce(array_agg(distinct x), '{}') into v_parties from (
    select party_id as x from public.application_parties where application_id = p_id
    union select v.applicant_party_id where v.applicant_party_id is not null) s;

  -- Surveys and notices of the application or its land.
  select coalesce(array_agg(id), '{}') into v_surveys from public.surveys where application_id = p_id or parcel_id = any (v_parcels);
  delete from public.survey_photos where survey_id = any (v_surveys);
  delete from public.surveys where id = any (v_surveys);
  delete from public.public_notices where application_id = p_id or parcel_id = any (v_parcels);

  -- The land's invoices (lines and pay links go with them) and other land records.
  delete from public.payment_intents where invoice_id = any (v_invoices);
  delete from public.invoices where id = any (v_invoices);
  delete from public.parcel_owners where parcel_id = any (v_parcels) or source_application_id = p_id;
  delete from public.buildings where parcel_id = any (v_parcels);
  delete from public.exemptions where parcel_id = any (v_parcels);
  delete from public.parcel_history where parcel_id = any (v_parcels);
  update public.applications set parcel_id = null where id = p_id;
  delete from public.parcels where id = any (v_parcels);

  -- The application (documents, events and owner links cascade).
  delete from public.applications where id = p_id;

  foreach v_party in array v_parties loop
    if not exists (select 1 from public.application_parties where party_id = v_party)
       and not exists (select 1 from public.applications where applicant_party_id = v_party)
       and not exists (select 1 from public.parcel_owners where party_id = v_party)
       and not exists (select 1 from public.issued_documents where party_id = v_party)
       and not exists (select 1 from public.leases where lessee_party_id = v_party) then
      delete from public.parties where id = v_party;
    end if;
  end loop;
end;
$$;
revoke all on function public.application_delete(uuid) from public, anon;
grant execute on function public.application_delete(uuid) to authenticated;
