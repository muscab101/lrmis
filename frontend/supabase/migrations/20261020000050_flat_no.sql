-- ============================================================================
-- 0050 Flat number for apartments.
--
-- When the land is an apartment block, staff also record which flat it is
-- (flat_no) next to the House No. Like the House No it is entered on the
-- application, the surveyor can correct it, and it is carried to the parcel.
-- ============================================================================

alter table public.applications
  add column flat_no text check (flat_no is null or length(flat_no) <= 20);
alter table public.parcels
  add column flat_no text check (flat_no is null or length(flat_no) <= 20);

-- The parcel takes the application's details when it's created …
create or replace function private.parcel_copy_application_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.applications;
begin
  if new.application_id is not null then
    select * into a from public.applications where id = new.application_id;
    new.house_no := coalesce(new.house_no, a.house_no);
    new.flat_no := coalesce(new.flat_no, a.flat_no);
    new.govt_receipt_no := coalesce(new.govt_receipt_no, a.govt_receipt_no);
    new.property_type := coalesce(new.property_type, a.property_type);
    new.land_use := coalesce(a.land_use, new.land_use);
  end if;
  return new;
end;
$$;

-- … and follows later changes until it's registered (or locked).
drop trigger details_to_parcel on public.applications;
create or replace function private.application_details_to_parcel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parcel_id is not null
     and (new.house_no is distinct from old.house_no or new.flat_no is distinct from old.flat_no
          or new.govt_receipt_no is distinct from old.govt_receipt_no
          or new.property_type is distinct from old.property_type or new.land_use is distinct from old.land_use) then
    update public.parcels
       set house_no = new.house_no, flat_no = new.flat_no, govt_receipt_no = new.govt_receipt_no,
           property_type = new.property_type,
           land_use = case when status = 'registered' then land_use else coalesce(new.land_use, land_use) end
     where id = new.parcel_id and locked_at is null;
  end if;
  return new;
end;
$$;
create trigger details_to_parcel after update of house_no, flat_no, govt_receipt_no, property_type, land_use on public.applications
  for each row execute function private.application_details_to_parcel();

/** Staff set the office details on an application they can edit. */
drop function public.application_set_details(uuid, text, text, text, text);
create function public.application_set_details(
  p_id uuid, p_house_no text, p_govt_receipt_no text, p_property_type text default null, p_land_use text default null,
  p_flat_no text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_edit_application(p_id);
  update public.applications
     set house_no = nullif(trim(p_house_no), ''),
         flat_no = nullif(trim(p_flat_no), ''),
         govt_receipt_no = nullif(trim(p_govt_receipt_no), ''),
         property_type = nullif(trim(p_property_type), ''),
         land_use = nullif(trim(p_land_use), '')::public.land_use
   where id = p_id;
end;
$$;
revoke all on function public.application_set_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.application_set_details(uuid, text, text, text, text, text) to authenticated;

/** The surveyor's on-site correction also covers the flat number (kept when not sent). */
create or replace function public.survey_update_details(p_survey uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.surveys;
  v_app public.applications;
  v_width numeric := nullif(p ->> 'plot_width_m', '')::numeric;
  v_length numeric := nullif(p ->> 'plot_length_m', '')::numeric;
begin
  select * into v from public.surveys where id = p_survey;
  if v.id is null or not private.can_view_survey(p_survey) then
    perform private.raise_app_error('NOT_FOUND', 'survey');
  end if;
  select * into v_app from public.applications where id = v.application_id;
  if not (v.surveyor_id = auth.uid() and public.has_permission('surveys.update'))
     and not (public.has_permission('surveys.approve') and public.can_access_district(v_app.district_id)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'not your survey');
  end if;
  if v.status not in ('assigned', 'in_progress', 'returned') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if (v_width is not null and v_width <= 0) or (v_length is not null and v_length <= 0) then
    perform private.raise_app_error('VALIDATION', 'plot_size');
  end if;
  update public.applications
     set plot_no = nullif(trim(p ->> 'plot_no'), ''),
         house_no = nullif(trim(p ->> 'house_no'), ''),
         flat_no = case when p ? 'flat_no' then nullif(trim(p ->> 'flat_no'), '') else flat_no end,
         govt_receipt_no = nullif(trim(p ->> 'govt_receipt_no'), ''),
         plot_width_m = v_width,
         plot_length_m = v_length,
         address_note = coalesce(trim(p ->> 'address_note'), address_note),
         property_type = case when p ? 'property_type' then nullif(trim(p ->> 'property_type'), '') else property_type end
   where id = v_app.id;
  update public.parcels set plot_no = nullif(trim(p ->> 'plot_no'), '')
   where id = v_app.parcel_id and locked_at is null;
  perform private.application_event(v_app.id, 'details_corrected_on_survey', v_app.status, v_app.status,
    concat_ws(' · ', 'plot ' || nullif(trim(p ->> 'plot_no'), ''), 'house ' || nullif(trim(p ->> 'house_no'), ''),
              'flat ' || nullif(trim(p ->> 'flat_no'), ''),
              'receipt ' || nullif(trim(p ->> 'govt_receipt_no'), ''),
              case when v_width is not null and v_length is not null then v_width || ' × ' || v_length || ' m' end,
              'type ' || nullif(trim(p ->> 'property_type'), '')));
end;
$$;

/** Edit the parcel's office details. p: {house_no, flat_no?, govt_receipt_no, plot_no}; flat_no is kept when not sent. */
create or replace function public.parcel_update_details(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
begin
  perform private.assert_permission('parcels.update');
  select * into v from public.parcels where id = p_id and deleted_at is null for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'parcel');
  end if;
  if v.locked_at is not null then
    perform private.raise_app_error('PARCEL_LOCKED', v.pun);
  end if;
  update public.parcels
     set house_no = nullif(trim(p ->> 'house_no'), ''),
         flat_no = case when p ? 'flat_no' then nullif(trim(p ->> 'flat_no'), '') else flat_no end,
         govt_receipt_no = nullif(trim(p ->> 'govt_receipt_no'), ''),
         plot_no = nullif(trim(p ->> 'plot_no'), '')
   where id = p_id;
  perform private.parcel_event(p_id, 'details_updated', null,
    jsonb_build_object('house_no', p ->> 'house_no', 'flat_no', p ->> 'flat_no',
                       'govt_receipt_no', p ->> 'govt_receipt_no', 'plot_no', p ->> 'plot_no'));
end;
$$;
