-- Certificate design: a power (on/off per role or per user) to change how certificates look — the main colour, the
-- two titles, the security watermark and seals, and a footer note. Every certificate printed afterwards uses it.

insert into public.permissions (key, module, action, is_special, description_en, description_so, sort)
values ('certificates.design', 'certificates', 'design', true, 'Change how certificates look',
        'Beddel muuqaalka shahaadooyinka', 366)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, 'certificates.design' from public.roles r where r.key = 'admin'
on conflict do nothing;
update public.roles set default_permissions = array(select distinct x from unnest(default_permissions || array['certificates.design']) x)
 where key = 'admin';

insert into public.settings (key, value, description)
values ('certificates.design', '{}'::jsonb, 'How certificates look (Admin → Certificate design)')
on conflict (key) do nothing;

/** Save the certificate design. Empty texts fall back to the standard titles. */
create or replace function public.certificate_design_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_permission('certificates.design');
  if coalesce(p ->> 'accent', '') !~ '^#[0-9a-fA-F]{6}$' then
    perform private.raise_app_error('VALIDATION', 'colour');
  end if;
  if length(coalesce(p ->> 'title_so', '')) > 120 or length(coalesce(p ->> 'title_en', '')) > 120 or length(coalesce(p ->> 'note', '')) > 300 then
    perform private.raise_app_error('VALIDATION', 'too_long');
  end if;
  v := jsonb_build_object(
    'accent', lower(p ->> 'accent'),
    'title_so', nullif(trim(coalesce(p ->> 'title_so', '')), ''),
    'title_en', nullif(trim(coalesce(p ->> 'title_en', '')), ''),
    'note', nullif(trim(coalesce(p ->> 'note', '')), ''),
    'watermark', coalesce((p ->> 'watermark')::boolean, true),
    'seals', coalesce((p ->> 'seals')::boolean, true));
  insert into public.settings (key, value, description, updated_at, updated_by)
  values ('certificates.design', v, 'How certificates look (Admin → Certificate design)', now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return v;
end;
$$;
revoke all on function public.certificate_design_save(jsonb) from public, anon;
grant execute on function public.certificate_design_save(jsonb) to authenticated;
