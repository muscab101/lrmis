-- ============================================================================
-- 0056 Edit and delete on every Valuation tab.
--
--  * Property grades: delete; a grade used by land or buildings is switched off.
--  * Rates: edit and delete while no assessment was made with the rate
--    (otherwise add a new rate from a date, so issued bills keep their numbers).
--  * Assessments: delete the live one when it has no invoice and no appeal;
--    the one it replaced (if any) becomes live again. Editing is re-assessing.
--  * Exemptions: edit and delete while pending.
--  * Appeals: edit and delete while open.
-- ============================================================================

create function public.valuation_delete_grade(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.property_grades;
begin
  perform private.assert_permission('valuation.update');
  select * into v from public.property_grades where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'grade');
  end if;
  if exists (select 1 from public.buildings where grade_id = p_id)
     or exists (select 1 from public.applications where property_type = v.code)
     or exists (select 1 from public.parcels where property_type = v.code) then
    update public.property_grades set active = false where id = p_id;
    return 'hidden';
  end if;
  delete from public.property_grades where id = p_id;
  return 'deleted';
end;
$$;

/** A rate an assessment was made with can't change. */
create function private.assert_rate_editable(p_id uuid)
returns public.neighbourhood_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.neighbourhood_rates;
begin
  perform private.assert_permission('valuation.update');
  select * into v from public.neighbourhood_rates where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'rate');
  end if;
  if exists (select 1 from public.assessments where rate_id = p_id) then
    perform private.raise_app_error('CONFLICT', 'rate_in_use');
  end if;
  return v;
end;
$$;

/** p: {rate_m2, service_charge, valid_from, note}. */
create function public.valuation_update_rate(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric := nullif(p ->> 'rate_m2', '')::numeric;
  v_service numeric := coalesce(nullif(p ->> 'service_charge', '')::numeric, 0);
begin
  perform private.assert_rate_editable(p_id);
  if v_rate is null or v_rate < 0 or v_service < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  update public.neighbourhood_rates
     set rate_m2 = v_rate, service_charge = v_service,
         valid_from = coalesce(nullif(p ->> 'valid_from', '')::date, valid_from),
         note = nullif(trim(p ->> 'note'), '')
   where id = p_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'rate_date_taken');
end;
$$;

create function public.valuation_delete_rate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_rate_editable(p_id);
  delete from public.neighbourhood_rates where id = p_id;
end;
$$;

/** Delete the live assessment of a parcel and year; the one it replaced is live again. */
create function public.assessment_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessments;
begin
  perform private.assert_permission('valuation.approve');
  select * into v from public.assessments where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'assessment');
  end if;
  if v.status <> 'issued' then
    perform private.raise_app_error('CONFLICT', 'assessment_superseded');
  end if;
  if exists (select 1 from public.invoices where assessment_id = p_id) then
    perform private.raise_app_error('CONFLICT', 'assessment_billed');
  end if;
  if exists (select 1 from public.appeals where assessment_id = p_id or new_assessment_id = p_id) then
    perform private.raise_app_error('CONFLICT', 'assessment_appealed');
  end if;
  delete from public.assessments where id = p_id;
  if v.supersedes_id is not null then
    update public.assessments set status = 'issued' where id = v.supersedes_id;
  end if;
  perform private.parcel_event(v.parcel_id, 'assessment_deleted', v.number, jsonb_build_object('year', v.year, 'total', v.total));
end;
$$;

/** A pending exemption in the caller's districts. */
create function private.assert_exemption_pending(p_id uuid)
returns public.exemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.exemptions;
begin
  perform private.assert_permission('valuation.create');
  select * into v from public.exemptions where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'exemption');
  end if;
  perform private.assert_parcel_scope(v.parcel_id);
  if v.status <> 'pending' then
    perform private.raise_app_error('CONFLICT', 'decided');
  end if;
  return v;
end;
$$;

/** p: {kind, pct, reason, valid_from, valid_to}. */
create function public.exemption_update(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_exemption_pending(p_id);
  if coalesce(trim(p ->> 'reason'), '') = '' then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  update public.exemptions
     set kind = (p ->> 'kind')::public.exemption_kind, pct = (p ->> 'pct')::numeric, reason = trim(p ->> 'reason'),
         valid_from = (p ->> 'valid_from')::date, valid_to = nullif(p ->> 'valid_to', '')::date
   where id = p_id;
end;
$$;

create function public.exemption_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.exemptions := private.assert_exemption_pending(p_id);
begin
  delete from public.exemptions where id = p_id;
  perform private.parcel_event(v.parcel_id, 'exemption_deleted', v.reason, jsonb_build_object('kind', v.kind, 'pct', v.pct));
end;
$$;

/** An open appeal the caller may change: its filer, or valuation staff in the district. */
create function private.assert_appeal_open(p_id uuid)
returns public.appeals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appeals;
  v_district uuid;
begin
  select * into v from public.appeals where id = p_id for update;
  if v.id is null then
    perform private.raise_app_error('NOT_FOUND', 'appeal');
  end if;
  select district_id into v_district from public.assessments where id = v.assessment_id;
  if not (v.filed_by = auth.uid()
          or (public.has_permission('valuation.create') and public.can_access_district(v_district))) then
    perform private.raise_app_error('NOT_FOUND', 'appeal');
  end if;
  if v.status <> 'open' then
    perform private.raise_app_error('CONFLICT', 'decided');
  end if;
  return v;
end;
$$;

create function public.appeal_update(p_id uuid, p_reason text, p_requested numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_appeal_open(p_id);
  if length(coalesce(trim(p_reason), '')) < 10 then
    perform private.raise_app_error('VALIDATION', 'reason');
  end if;
  if p_requested is not null and p_requested < 0 then
    perform private.raise_app_error('VALIDATION', 'amount');
  end if;
  update public.appeals set reason = trim(p_reason), requested_total = p_requested where id = p_id;
end;
$$;

create function public.appeal_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appeals := private.assert_appeal_open(p_id);
begin
  delete from public.appeals where id = p_id;
  perform private.parcel_event(v.parcel_id, 'appeal_deleted', v.reason, null);
end;
$$;

revoke all on function private.assert_rate_editable(uuid), private.assert_exemption_pending(uuid), private.assert_appeal_open(uuid)
  from public, anon, authenticated;
revoke all on function public.valuation_delete_grade(uuid), public.valuation_update_rate(uuid, jsonb), public.valuation_delete_rate(uuid),
  public.assessment_delete(uuid), public.exemption_update(uuid, jsonb), public.exemption_delete(uuid),
  public.appeal_update(uuid, text, numeric), public.appeal_delete(uuid) from public, anon;
grant execute on function public.valuation_delete_grade(uuid), public.valuation_update_rate(uuid, jsonb), public.valuation_delete_rate(uuid),
  public.assessment_delete(uuid), public.exemption_update(uuid, jsonb), public.exemption_delete(uuid),
  public.appeal_update(uuid, text, numeric), public.appeal_delete(uuid) to authenticated;
