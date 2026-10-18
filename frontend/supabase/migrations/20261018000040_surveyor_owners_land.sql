-- ============================================================================
-- 0040 Surveyors can create owners and land, and correct land details on site.
--
-- * The Surveyor role gets owners.view/create/update and applications.create,
--   so a surveyor can register an owner and start a land parcel from the field.
-- * While a survey is open, the assigned surveyor (or a survey supervisor with
--   surveys.approve) can correct the land details the application carries:
--   plot no, house no, govt. receipt, declared width × length, address note.
--   The application is otherwise locked after submission; this is the one
--   field-correction path, and it's recorded in the application's history.
-- ============================================================================

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['owners.view', 'owners.create', 'owners.update', 'applications.create']) k
 where r.key = 'surveyor'
on conflict do nothing;
update public.roles
   set default_permissions = (select array_agg(distinct x) from unnest(default_permissions
         || array['owners.view', 'owners.create', 'owners.update', 'applications.create']) x)
 where key = 'surveyor';

/** p: {plot_no, house_no, govt_receipt_no, plot_width_m, plot_length_m, address_note}. */
create function public.survey_update_details(p_survey uuid, p jsonb)
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
         govt_receipt_no = nullif(trim(p ->> 'govt_receipt_no'), ''),
         plot_width_m = v_width,
         plot_length_m = v_length,
         address_note = coalesce(trim(p ->> 'address_note'), address_note)
   where id = v_app.id;
  update public.parcels set plot_no = nullif(trim(p ->> 'plot_no'), '')
   where id = v_app.parcel_id and locked_at is null;
  perform private.application_event(v_app.id, 'details_corrected_on_survey', v_app.status, v_app.status,
    concat_ws(' · ', 'plot ' || nullif(trim(p ->> 'plot_no'), ''), 'house ' || nullif(trim(p ->> 'house_no'), ''),
              'receipt ' || nullif(trim(p ->> 'govt_receipt_no'), ''),
              case when v_width is not null and v_length is not null then v_width || ' × ' || v_length || ' m' end));
end;
$$;
revoke all on function public.survey_update_details(uuid, jsonb) from public, anon;
grant execute on function public.survey_update_details(uuid, jsonb) to authenticated;
