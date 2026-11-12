-- Two access rules worked out who is signed in again for every row; now once per query (same rule, faster).

alter policy cash_handovers_select on public.cash_handovers using (
  from_user = (select auth.uid()) or to_user = (select auth.uid())
  or ((public.has_permission('reconciliation.view') or public.has_permission('payments.approve'))
      and (district_id is null or public.can_access_district(district_id))));

alter policy survey_zones_select on public.survey_zones using (
  surveyor_id = (select auth.uid()) or (public.has_permission('surveys.view') and public.can_access_district(district_id)));
