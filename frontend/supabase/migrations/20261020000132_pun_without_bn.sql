-- PUNs drop the "BN" in front (owner decision 2026-10-31): BN34KRWJXL0107 -> 34KRWJXL0107. Existing PUNs are renamed,
-- and so is every copy of them kept for display: certificate and ID card snapshots, invoice line text, parcel history
-- details and notifications. Sent SMS messages, the audit log and journal memos keep what they said at the time.
-- Searches still find land when an old printout with BN is typed in (the app strips it).

update public.settings set value = '"{district}{neighbourhood}{serial:2}"'::jsonb where key = 'registration.pun_format';

create or replace function private.next_pun(p_district uuid, p_neighbourhood uuid)
returns table (pun text, account_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_serial int;
  v_account int;
  v_dcode text;
  v_ncode text;
  v_pun text;
begin
  insert into public.pun_counters (district_id) values (p_district) on conflict do nothing;
  select code into v_dcode from public.districts where id = p_district;
  select code into v_ncode from public.neighbourhoods where id = p_neighbourhood;
  -- Row lock: concurrent registrations in a district queue here, so numbers have no gaps or duplicates.
  update public.pun_counters set last_account = last_account + 1 where district_id = p_district returning last_account into v_account;
  loop
    update public.pun_counters set last_serial = last_serial + 1 where district_id = p_district returning last_serial into v_serial;
    v_pun := private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.pun_format'),
                                            '{district}{neighbourhood}{serial:2}'), v_dcode, v_ncode, v_serial);
    exit when not exists (select 1 from public.parcels p where p.pun = v_pun);
  end loop;
  return query select v_pun,
    private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'),
                                   '{district}{serial:7}'), v_dcode, v_ncode, v_account);
end;
$$;

-- The old and new PUN of every parcel, longest first so BN…0107A is replaced before BN…0107.
create temporary table pun_rename on commit drop as
  select pun as old_pun, substr(pun, 3) as new_pun from public.parcels where pun like 'BN%' order by length(pun) desc;

-- Locked land is renamed too: the lock guard stops any edit, so it is paused for this one update.
alter table public.parcels disable trigger lock_guard;
update public.parcels set pun = substr(pun, 3) where pun like 'BN%';
alter table public.parcels enable trigger lock_guard;

do $$
declare
  r record;
begin
  for r in select * from pg_temp.pun_rename order by length(old_pun) desc loop
    update public.issued_documents set snapshot = replace(snapshot::text, r.old_pun, r.new_pun)::jsonb where strpos(snapshot::text, r.old_pun) > 0;
    update public.invoice_lines set description = replace(description, r.old_pun, r.new_pun) where strpos(description, r.old_pun) > 0;
    update public.parcel_history set data = replace(data::text, r.old_pun, r.new_pun)::jsonb where strpos(data::text, r.old_pun) > 0;
    update public.parcel_changes set payload = replace(payload::text, r.old_pun, r.new_pun)::jsonb where strpos(payload::text, r.old_pun) > 0;
    update public.notifications
       set title_en = replace(title_en, r.old_pun, r.new_pun), title_so = replace(title_so, r.old_pun, r.new_pun),
           body_en = replace(body_en, r.old_pun, r.new_pun), body_so = replace(body_so, r.old_pun, r.new_pun), link = replace(link, r.old_pun, r.new_pun)
     where strpos(coalesce(title_en, '') || coalesce(title_so, '') || coalesce(body_en, '') || coalesce(body_so, '') || coalesce(link, ''), r.old_pun) > 0;
  end loop;
end;
$$;
