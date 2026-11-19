-- Who may see land, bills and payments: the same rules, worked out once per query instead of once per row.
-- Each rule called a function per row that looked the row up again and re-read the viewer's powers and districts.
-- With ~4,600 plots (after the old LRMIS data) every list or count of land took 0.5–0.8 s, and pages that make several
-- such queries (Incomplete, Dashboard, Parcels) took many seconds. Now the viewer's powers, districts, own plots and
-- zones are read once ("(select …)" is worked out once by Postgres) and each row only compares its own columns.
-- private.can_view_parcel / can_view_invoice_district / can_view_payment are kept for the code that calls them.

/** The viewer sees every district (and is an active account). */
create or replace function private.viewer_sees_all_districts()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return false; end if;
  perform private.viewer_load();
  return current_setting('dhulka.viewer_active', true) = 'true' and current_setting('dhulka.viewer_all', true) = 'true';
end;
$$;

/** The districts the viewer covers (empty for an inactive account). */
create or replace function private.viewer_district_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return '{}'; end if;
  perform private.viewer_load();
  if current_setting('dhulka.viewer_active', true) <> 'true' then return '{}'; end if;
  return coalesce(nullif(current_setting('dhulka.viewer_districts', true), '')::uuid[], '{}');
end;
$$;

/** Land the viewer owns now (as an owner record of theirs). */
create or replace function private.my_owned_parcel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select po.parcel_id from public.parcel_owners po
   where po.valid_to is null and po.party_id in (select private.my_party_ids());
$$;

/** Neighbourhoods of the viewer's survey zones. */
create or replace function private.my_zone_neighbourhood_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select z.neighbourhood_id from public.survey_zones z where z.surveyor_id = auth.uid() and z.neighbourhood_id is not null;
$$;

revoke all on function private.viewer_sees_all_districts(), private.viewer_district_ids(), private.my_owned_parcel_ids(),
  private.my_zone_neighbourhood_ids() from public, anon;
grant execute on function private.viewer_sees_all_districts(), private.viewer_district_ids(), private.my_owned_parcel_ids(),
  private.my_zone_neighbourhood_ids() to authenticated;
-- The land rule now asks it directly (before, only from inside can_view_parcel). It only says whether the caller's own
-- account is active.
grant execute on function private.caller_is_active() to authenticated;

-- Land: as private.can_view_parcel(id).
alter policy parcels_select on public.parcels using (
  (select private.caller_is_active())
  and (
    ((select public.has_permission('parcels.view'))
      and ((select private.viewer_sees_all_districts()) or district_id = any ((select private.viewer_district_ids())::uuid[]))
      -- Registered land only for roles allowed to see it (Admin → Roles: "See registered land").
      and (status not in ('registered', 'disputed') or (select public.has_permission('parcels.registered'))))
    or site_check_surveyor = (select auth.uid())
    or id in (select private.my_owned_parcel_ids())
    or (application_id is not null and private.can_view_application(application_id))
    -- Surveyors: the land they recorded, and every house in the neighbourhoods of their zones.
    or ((select public.has_permission('surveys.create'))
        and (created_by = (select auth.uid()) or neighbourhood_id in (select private.my_zone_neighbourhood_ids())))
  )
);

-- Bills: as private.can_view_invoice_district(district_id) or private.is_parcel_owner(parcel_id).
alter policy invoices_select on public.invoices using (
  (((select public.has_permission('invoices.view')) or (select public.has_permission('billing.view')))
    and ((select private.viewer_sees_all_districts()) or district_id = any ((select private.viewer_district_ids())::uuid[])))
  or parcel_id in (select private.my_owned_parcel_ids())
);

-- Payments: as private.can_view_payment(district_id, parcel_id).
alter policy payments_select on public.payments using (
  (district_id is null and (select public.has_permission('payments.approve')))
  or (((select public.has_permission('payments.view')) or (select public.has_permission('cashier.view')))
      and district_id is not null
      and ((select private.viewer_sees_all_districts()) or district_id = any ((select private.viewer_district_ids())::uuid[])))
  or (parcel_id is not null and parcel_id in (select private.my_owned_parcel_ids()))
);

-- The dashboard figures and the Incomplete page's "left to register" totals asked "may the viewer see this district?"
-- once per row counted (15, 11 and 1 places). Now the viewer's districts are read once at the start of each function.
do $do$
declare
  f text;
  v text;
  v_new text;
begin
  foreach f in array array['public.dashboard_kpis()', 'public.dashboard_period(integer)', 'public.neighbourhood_remaining(integer)'] loop
    v := pg_get_functiondef(f::regprocedure);
    v_new := regexp_replace(v, 'public\.can_access_district\(([a-z0-9_.]+)\)', '(v_all or \1 = any (v_dists))', 'g');
    if v_new = v or position('can_access_district(' in v_new) > 0 then
      raise exception '%: district check not found, or one was left', f;
    end if;
    if position(E'declare\n' in v_new) = 0 then
      raise exception '%: no declare section', f;
    end if;
    v_new := regexp_replace(v_new, E'declare\n',
      E'declare\n  v_all boolean := private.viewer_sees_all_districts();\n  v_dists uuid[] := private.viewer_district_ids();\n');
    execute v_new;
  end loop;
end;
$do$;
