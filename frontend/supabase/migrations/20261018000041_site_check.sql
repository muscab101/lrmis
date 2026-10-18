-- ============================================================================
-- 0041 Site check: "does this land really exist?"
--
-- Application staff mark an application "!" (needs a site check). That assigns
-- a surveyor in the district (the least busy, unless one is chosen) and tells
-- them. The surveyor visits and confirms (✓) the land exists, or reports it
-- wasn't found. A supervisor with surveys.approve can confirm too.
-- ============================================================================

alter table public.applications
  add column site_check_status text check (site_check_status in ('pending', 'confirmed', 'not_found')),
  add column site_check_surveyor uuid references auth.users (id) on delete set null,
  add column site_check_requested_at timestamptz,
  add column site_check_requested_by uuid references auth.users (id) on delete set null,
  add column site_check_done_at timestamptz,
  add column site_check_done_by uuid references auth.users (id) on delete set null,
  add column site_check_note text;
create index applications_site_check_idx on public.applications (site_check_surveyor) where site_check_status = 'pending';
create index applications_site_check_requested_by_idx on public.applications (site_check_requested_by);
create index applications_site_check_done_by_idx on public.applications (site_check_done_by);

/** Mark "!": send a surveyor to check the land exists. Returns the surveyor's user id. */
create function public.application_request_site_check(p_id uuid, p_surveyor uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
  v_surveyor uuid := p_surveyor;
begin
  perform private.assert_permission('applications.update');
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not public.can_access_district(v.district_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.status in ('approved', 'rejected', 'cancelled') then
    perform private.raise_app_error('CONFLICT', 'status');
  end if;
  if v.site_check_status in ('pending', 'confirmed') then
    perform private.raise_app_error('CONFLICT', 'site_check_' || v.site_check_status);
  end if;
  if v_surveyor is null then
    -- Least busy surveyor in the district (open surveys + pending site checks).
    select p.user_id into v_surveyor
      from public.profiles p
     where p.kind = 'staff' and p.status = 'active' and p.deleted_at is null
       and not private.user_grants_all(p.user_id)
       and private.user_has_permission(p.user_id, 'surveys.create')
       and private.user_can_access_district(p.user_id, v.district_id)
     order by (select count(*) from public.surveys s where s.surveyor_id = p.user_id
                and s.status in ('assigned', 'in_progress', 'returned', 'overlap_review'))
            + (select count(*) from public.applications a where a.site_check_surveyor = p.user_id and a.site_check_status = 'pending'),
              p.full_name
     limit 1;
    if v_surveyor is null then
      perform private.raise_app_error('NOT_FOUND', 'surveyor');
    end if;
  elsif not (private.user_has_permission(v_surveyor, 'surveys.create') and private.user_can_access_district(v_surveyor, v.district_id)) then
    perform private.raise_app_error('VALIDATION', 'not_a_surveyor');
  end if;
  update public.applications
     set site_check_status = 'pending', site_check_surveyor = v_surveyor,
         site_check_requested_at = now(), site_check_requested_by = auth.uid(),
         site_check_done_at = null, site_check_done_by = null, site_check_note = nullif(trim(p_note), '')
   where id = p_id;
  perform private.application_event(p_id, 'site_check_requested', v.status, v.status, nullif(trim(p_note), ''));
  perform private.notify(v_surveyor, 'application.site_check',
    'Hubi in dhulka ' || v.number || ' jiro', 'Check that the land for ' || v.number || ' exists',
    '/applications/' || p_id);
  return v_surveyor;
end;
$$;

/** ✓ the land exists (p_exists = true), or report it wasn't found (a note is required). */
create function public.application_confirm_site(p_id uuid, p_exists boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.applications;
begin
  select * into v from public.applications where id = p_id for update;
  if v.id is null or not private.can_view_application(p_id) then
    perform private.raise_app_error('NOT_FOUND', 'application');
  end if;
  if v.site_check_status is distinct from 'pending' then
    perform private.raise_app_error('CONFLICT', 'no_site_check');
  end if;
  if not (v.site_check_surveyor = auth.uid() and public.has_permission('surveys.update'))
     and not (public.has_permission('surveys.approve') and public.can_access_district(v.district_id)) then
    perform private.raise_app_error('PERMISSION_DENIED', 'not your site check');
  end if;
  if not p_exists and length(coalesce(trim(p_note), '')) < 5 then
    perform private.raise_app_error('VALIDATION', 'note_required');
  end if;
  update public.applications
     set site_check_status = case when p_exists then 'confirmed' else 'not_found' end,
         site_check_done_at = now(), site_check_done_by = auth.uid(),
         site_check_note = coalesce(nullif(trim(p_note), ''), site_check_note)
   where id = p_id;
  perform private.application_event(p_id, case when p_exists then 'site_confirmed' else 'site_not_found' end,
                                    v.status, v.status, nullif(trim(p_note), ''));
  if v.site_check_requested_by is not null and v.site_check_requested_by <> auth.uid() then
    perform private.notify(v.site_check_requested_by, 'application.site_checked',
      case when p_exists then 'Dhulka ' || v.number || ' waa jiraa' else 'Dhulka ' || v.number || ' lama helin' end,
      case when p_exists then 'Land for ' || v.number || ' confirmed' else 'Land for ' || v.number || ' not found' end,
      '/applications/' || p_id);
  end if;
end;
$$;

revoke all on function public.application_request_site_check(uuid, uuid, text), public.application_confirm_site(uuid, boolean, text) from public, anon;
grant execute on function public.application_request_site_check(uuid, uuid, text), public.application_confirm_site(uuid, boolean, text) to authenticated;
