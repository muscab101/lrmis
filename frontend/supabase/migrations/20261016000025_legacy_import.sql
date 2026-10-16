-- ============================================================================
-- 0025 Phase 12: import of legacy paper / spreadsheet records.
-- Each legacy record becomes an office application (draft) with its owner, so it goes
-- through survey, verification, notice and registration like any new case. Re-running the
-- same file is safe: rows are keyed by their legacy reference.
-- ============================================================================

alter table public.applications add column legacy_ref text;
create unique index applications_legacy_ref_uidx on public.applications (legacy_ref) where legacy_ref is not null;
create index parties_legacy_id_idx on public.parties (legacy_id) where legacy_id is not null;

/**
 * p: legacy_ref, full_name, mother_name, gender, phone, id_type, id_number, district_code,
 *    neighbourhood_code, lon, lat, plot_no, old_deed_no, govt_file_no, address_note.
 * Returns {status: created | exists | invalid, number?, problems?[]}. With p_dry nothing is written.
 */
create or replace function public.legacy_import_row(p jsonb, p_actor uuid, p_batch text, p_dry boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_ref text := nullif(trim(p ->> 'legacy_ref'), '');
  v_name text := nullif(regexp_replace(trim(coalesce(p ->> 'full_name', '')), '\s+', ' ', 'g'), '');
  v_phone text := nullif(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
  v_id_number text := private.normalise_id_number(p ->> 'id_number');
  v_id_type public.id_document_type;
  v_district uuid;
  v_nbhd uuid;
  v_pin extensions.geometry;
  v_party uuid;
  v_app uuid;
  v_number text;
begin
  if not exists (select 1 from public.profiles where user_id = p_actor and kind = 'staff' and status = 'active') then
    perform private.raise_app_error('VALIDATION', 'actor');
  end if;
  if v_ref is null then v_problems := array_append(v_problems, 'legacy_ref'); end if;
  if v_ref is not null and exists (select 1 from public.applications where legacy_ref = v_ref) then
    return jsonb_build_object('status', 'exists', 'number', (select number from public.applications where legacy_ref = v_ref));
  end if;
  if v_name is null or length(v_name) < 3 then v_problems := array_append(v_problems, 'full_name'); end if;
  if coalesce(lower(trim(p ->> 'gender')), '') not in ('', 'male', 'female') then v_problems := array_append(v_problems, 'gender'); end if;
  if v_phone is not null then
    if v_phone like '0%' then v_phone := '+252' || substr(v_phone, 2);
    elsif v_phone !~ '^\+' then v_phone := '+' || v_phone; end if;
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_problems := array_append(v_problems, 'phone'); v_phone := null; end if;
  end if;
  if v_id_number is not null then
    begin
      v_id_type := coalesce(nullif(p ->> 'id_type', ''), 'national_id')::public.id_document_type;
    exception when others then
      v_problems := array_append(v_problems, 'id_type');
    end;
  end if;
  select id into v_district from public.districts where code = upper(trim(p ->> 'district_code')) and deleted_at is null;
  if v_district is null then
    v_problems := array_append(v_problems, 'district_code');
  else
    if nullif(trim(p ->> 'neighbourhood_code'), '') is not null then
      select n.id into v_nbhd from public.neighbourhoods n where n.district_id = v_district and n.code = trim(p ->> 'neighbourhood_code') and n.deleted_at is null;
      if v_nbhd is null then v_problems := array_append(v_problems, 'neighbourhood_code'); end if;
    end if;
    if nullif(p ->> 'lon', '') is not null and nullif(p ->> 'lat', '') is not null then
      begin
        v_pin := extensions.st_setsrid(extensions.st_makepoint((p ->> 'lon')::float8, (p ->> 'lat')::float8), 4326);
        v_nbhd := private.check_application_location(v_district, v_nbhd, v_pin);
      exception when others then
        v_problems := array_append(v_problems, 'location');
        v_pin := null;
      end;
    end if;
  end if;

  if cardinality(v_problems) > 0 then
    return jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  end if;
  if p_dry then
    return jsonb_build_object('status', 'would_create');
  end if;

  -- Reuse a person already on the register: same ID document, else same legacy id, else same phone and name.
  select id into v_party from public.parties
   where deleted_at is null and (
         (v_id_number is not null and id_type = v_id_type and private.normalise_id_number(id_number) = v_id_number)
      or (legacy_id is not null and legacy_id = v_ref)
      or (v_phone is not null and phone = v_phone and lower(full_name) = lower(v_name)))
   order by created_at limit 1;
  if v_party is null then
    insert into public.parties (full_name, mother_name, gender, phone, id_type, id_number, district_id, legacy_id, created_by)
    values (v_name, nullif(trim(p ->> 'mother_name'), ''), nullif(lower(trim(p ->> 'gender')), '')::text, v_phone,
            case when v_id_number is null then null else v_id_type end, v_id_number, v_district, v_ref, p_actor)
    returning id into v_party;
  end if;

  v_number := 'APP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.application_number_seq')::text, 6, '0');
  insert into public.applications (number, type, channel, district_id, neighbourhood_id, pin, address_note, plot_no, old_deed_no,
                                   govt_file_no, applicant_party_id, created_by, legacy_ref)
  values (v_number, 'new_registration', 'office', v_district, v_nbhd, v_pin,
          left(coalesce(trim(p ->> 'address_note'), ''), 500), nullif(trim(p ->> 'plot_no'), ''), nullif(trim(p ->> 'old_deed_no'), ''),
          nullif(trim(p ->> 'govt_file_no'), ''), v_party, p_actor, v_ref)
  returning id into v_app;
  insert into public.application_parties (application_id, party_id, role, share_pct, added_by) values (v_app, v_party, 'owner', 100, p_actor);
  perform private.application_event(v_app, 'imported', null, 'draft', 'Legacy import ' || coalesce(p_batch, ''));
  return jsonb_build_object('status', 'created', 'number', v_number);
end;
$$;
revoke execute on function public.legacy_import_row(jsonb, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.legacy_import_row(jsonb, uuid, text, boolean) to service_role;
