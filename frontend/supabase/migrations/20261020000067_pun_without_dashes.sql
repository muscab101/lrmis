-- PUNs without dashes: BN-01-01-01 → BN010101. Existing PUNs and the PUN inside documents' snapshots
-- follow. Without separators two neighbourhood codes of different lengths could produce the same PUN
-- (01 + 101 and 011 + 01), so next_pun skips any number whose PUN is already taken.

update public.settings set value = to_jsonb('BN{district}{neighbourhood}{serial:2}'::text)
 where key = 'registration.pun_format' and value #>> '{}' = 'BN-{district}-{neighbourhood}-{serial:2}';

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
                                            'BN{district}{neighbourhood}{serial:2}'), v_dcode, v_ncode, v_serial);
    exit when not exists (select 1 from public.parcels p where p.pun = v_pun);
  end loop;
  return query select v_pun,
    private.format_serial(coalesce((select value #>> '{}' from public.settings where key = 'registration.account_format'),
                                   '{district}{serial:7}'), v_dcode, v_ncode, v_account);
end;
$$;

do $$
declare
  r record;
begin
  for r in select id, pun as old_pun, replace(pun, '-', '') as new_pun from public.parcels where pun like '%-%' loop
    update public.parcels set pun = r.new_pun where id = r.id;
    update public.issued_documents
       set snapshot = replace(snapshot::text, '"' || r.old_pun || '"', '"' || r.new_pun || '"')::jsonb
     where snapshot::text like '%"' || r.old_pun || '"%';
  end loop;
end $$;
