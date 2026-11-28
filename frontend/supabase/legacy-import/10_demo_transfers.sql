-- Made-up DEMO ownership transfers (owner's request, 2026-11-28): about 80 transfers on DEMO houses, through the
-- system's own transfer functions, in every state: most approved (ownership really changed), some submitted, under
-- review, waiting for documents, rejected, cancelled or still draft. Reasons: sale, inheritance (2–3 heirs sharing),
-- gift, family transfer, administrative correction and other. New owners are made-up too: parties.legacy_id
-- 'DEMO-T nnnnn', phones +252 6008 xxxxx, never messaged (migration 0301).
-- Run as a super admin (request.jwt.claims set), in three steps:
--   1. select private.demo_transfers_create(<how many>, <first number>);   -- drafts + new owners, plan kept below
--   2. upload the sample files to transfer-documents/<transfer id>/agreement.pdf and id-card.png
--   3. select private.demo_transfers_finish(<approver user id>);           -- documents, submit, review, decide, dates

create table if not exists private.demo_transfer_plan (
  transfer_id uuid primary key references public.transfers (id) on delete cascade,
  target text not null,          -- approved, submitted, under_review, needs_documents, rejected, cancelled, draft
  type_name text not null,
  start_at timestamptz not null, -- when it was opened (the rest follows within days)
  done boolean not null default false
);
revoke all on private.demo_transfer_plan from public, anon, authenticated;

create or replace function private.demo_transfers_create(p_count int, p_start int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_m text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Ismaaciil','Abuukar','Siciid','Jaamac','Nuur','Warsame','Bashiir','Khaliif','Mahad','Liibaan','Sahal','Daahir'];
  first_f text[] := array['Faadumo','Caasha','Khadiija','Maryan','Xaawo','Sahra','Hodan','Ifraax','Nimco','Hibaaq','Sucaad','Deeqa','Ubax','Ayaan','Fartuun','Shukri','Hamdi','Naciima','Ruqiya','Zamzam'];
  fathers text[] := array['Cabdi','Maxamed','Axmed','Cali','Xasan','Xuseen','Yuusuf','Ibraahim','Cumar','Faarax','Muuse','Aadan','Siciid','Jaamac','Nuur','Warsame','Khaliif','Daahir','Shire','Guuleed','Mire','Samatar','Dirie','Elmi','Roble','Ciise','Barre'];
  t_owner uuid := (select id from public.owner_types where name_en = 'Owner');
  t_family uuid := (select id from public.owner_types where name_en = 'Family / Heirs');
  v_seq int := p_start;
  i int := 0;
  k int;
  heirs int;
  p record;
  v_type public.transfer_types;
  v_tname text;
  v_target text;
  v_id uuid;
  v_party uuid;
  v_owners jsonb;
  v_share numeric;
  v_left numeric;
  v_rand float8;
  v_g text;
  v_name text;
  v_family text;
begin
  for p in
    select pc.id, pc.district_id,
           (select pa.full_name from public.parcel_owners po join public.parties pa on pa.id = po.party_id
             where po.parcel_id = pc.id and po.valid_to is null limit 1) as owner_name
      from public.parcels pc
     where pc.legacy_ref like 'DEMO-%' and pc.legacy_ref not like 'DEMO-F%' and pc.parent_id is null and pc.layout = 'house'
       and pc.deleted_at is null and pc.status = 'registered'
       and not exists (select 1 from public.transfers t where t.parcel_id = pc.id)
       and (select count(*) from public.parcel_owners po where po.parcel_id = pc.id and po.valid_to is null) = 1
     order by md5(pc.id::text || p_start::text)
     limit p_count * 3
  loop
    exit when i >= p_count;
    continue when cardinality(private.parcel_blockers(p.id, 'transfer')) > 0;
    i := i + 1;
    -- The reason: mostly sales and inheritances.
    v_rand := random();
    v_tname := case when v_rand < 0.40 then 'Sale' when v_rand < 0.65 then 'Inheritance' when v_rand < 0.77 then 'Gift'
                    when v_rand < 0.89 then 'Family ownership transfer' when v_rand < 0.95 then 'Administrative correction' else 'Other' end;
    select * into v_type from public.transfer_types where name_en = v_tname and active;
    -- Where it ends up (by share of the total).
    v_target := case when i <= round(p_count * 0.56) then 'approved'
                     when i <= round(p_count * 0.66) then 'submitted'
                     when i <= round(p_count * 0.75) then 'under_review'
                     when i <= round(p_count * 0.81) then 'needs_documents'
                     when i <= round(p_count * 0.89) then 'rejected'
                     when i <= round(p_count * 0.94) then 'cancelled'
                     else 'draft' end;
    v_id := public.transfer_create_typed(p.id, v_type.id, null,
              case v_tname when 'Sale' then 'Iib: heshiis iibsi ayaa la keenay.'
                           when 'Inheritance' then 'Dhaxal: milkiilihii hore wuu dhintay, dhaxlayaasha ayaa loo wareejinayaa.'
                           when 'Gift' then 'Hadiyad: milkiiluhu wuxuu hibeeyay.'
                           when 'Family ownership transfer' then 'Wareejin qoys: waalidka ilaa ilmaha.'
                           when 'Administrative correction' then 'Sixitaan: magaca milkiilaha ayaa si khaldan loo qoray.'
                           else 'Wareejin kale.' end);
    if v_tname = 'Sale' then
      update public.transfers set declared_value = (5 + floor(random() * 60)) * 1000 where id = v_id;
    end if;

    -- The new owner(s): heirs share it; a sale is sometimes bought by two people; the rest go to one person.
    heirs := case when v_tname = 'Inheritance' then 2 + floor(random() * 2)::int
                  when v_tname = 'Sale' and random() < 0.2 then 2 else 1 end;
    v_family := fathers[1 + floor(random() * array_length(fathers, 1))::int];
    v_owners := '[]'::jsonb;
    v_left := 100;
    for k in 1 .. heirs loop
      v_seq := v_seq + 1;
      v_g := case when random() < 0.6 then 'male' else 'female' end;
      v_name := (case when v_g = 'male' then first_m[1 + floor(random() * array_length(first_m, 1))::int]
                      else first_f[1 + floor(random() * array_length(first_f, 1))::int] end)
                || ' ' || case when v_tname in ('Inheritance', 'Family ownership transfer') then split_part(p.owner_name, ' ', 1)
                               else fathers[1 + floor(random() * array_length(fathers, 1))::int] end
                || ' ' || case when v_tname in ('Inheritance', 'Family ownership transfer') then split_part(p.owner_name, ' ', 2) else v_family end;
      if v_tname = 'Administrative correction' then
        v_name := p.owner_name || case when random() < 0.5 then ' Cali' else ' Maxamed' end;  -- the full, corrected name
      end if;
      insert into public.parties (kind, full_name, gender, nationality, phone, district_id, owner_type_id, legacy_id, registered_at)
      values ('person', v_name, v_g, 'SO', '+2526008' || lpad(v_seq::text, 5, '0'), p.district_id,
              case when v_tname = 'Inheritance' then t_family else t_owner end, 'DEMO-T' || lpad(v_seq::text, 5, '0'), now())
      returning id into v_party;
      v_share := case when k = heirs then v_left
                      when heirs = 3 and k = 1 then 40
                      else round(100.0 / heirs, 2) end;
      v_left := v_left - v_share;
      v_owners := v_owners || jsonb_build_array(jsonb_build_object('party_id', v_party,
                    'role', case when v_tname = 'Inheritance' then 'heir' when heirs > 1 then 'co_owner' else 'owner' end,
                    'share_pct', v_share));
    end loop;
    perform public.transfer_set_recipients(v_id, v_owners);

    insert into private.demo_transfer_plan (transfer_id, target, type_name, start_at)
    values (v_id, v_target, v_tname, timestamptz '2026-02-01' + random() * (timestamptz '2026-11-10' - timestamptz '2026-02-01'));
  end loop;
  return jsonb_build_object('transfers', i, 'next', v_seq + 1);
end;
$$;
revoke all on function private.demo_transfers_create(int, int) from public, anon, authenticated;

-- Step 3: the sample files, then each transfer is moved to its planned state by a second person (p_approver),
-- and the dates are spread over 2026.
create or replace function private.demo_transfers_finish(p_approver uuid, p_pdf_size int, p_png_size int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_creator text := current_setting('request.jwt.claims', true);
  v_cat text;
  v_t timestamptz;
  n int := 0;
begin
  for r in select pl.*, t.number from private.demo_transfer_plan pl join public.transfers t on t.id = pl.transfer_id
            where not pl.done order by t.number loop
    v_cat := case r.type_name when 'Sale' then 'sale_agreement' when 'Inheritance' then 'inheritance'
                              when 'Administrative correction' then 'other' else 'transfer_agreement' end;
    perform public.transfer_document_add(r.transfer_id, r.transfer_id || '/agreement.pdf',
              case v_cat when 'sale_agreement' then 'Heshiiska iibka.pdf' when 'inheritance' then 'Xukunka dhaxalka.pdf'
                         when 'other' then 'Codsiga sixitaanka.pdf' else 'Heshiiska wareejinta.pdf' end,
              'application/pdf', p_pdf_size, v_cat, 'Sample document (demo)');
    perform public.transfer_document_add(r.transfer_id, r.transfer_id || '/id-card.png', 'Kaarka aqoonsiga.png',
              'image/png', p_png_size, 'identification', 'New owner''s ID (demo)');

    if r.target <> 'draft' then
      perform public.transfer_submit(r.transfer_id);
    end if;
    if r.target = 'cancelled' then
      perform public.transfer_cancel(r.transfer_id, 'Milkiiluhu wuu ka noqday iibka.');
    end if;

    -- Reviewing and deciding is someone else's work.
    if r.target in ('approved', 'under_review', 'needs_documents', 'rejected') then
      perform set_config('request.jwt.claims', json_build_object('sub', p_approver, 'role', 'authenticated', 'aal', 'aal2')::text, true);
      if r.target = 'needs_documents' then
        perform public.transfer_review(r.transfer_id, 'request_documents', 'Fadlan soo dir warqadda dhaxalka ama heshiiska oo saxeexan.');
      else
        perform public.transfer_review(r.transfer_id, 'start', null);
      end if;
      if r.target = 'approved' then
        perform public.transfer_decide(r.transfer_id, true, 'Dukumentiyada waa la hubiyay.');
      elsif r.target = 'rejected' then
        perform public.transfer_decide(r.transfer_id, false, 'Saxiixa heshiiska iyo aqoonsiga ma is waafaqsana.');
      end if;
      perform set_config('request.jwt.claims', v_creator, true);
    end if;

    -- The dates: opened on start_at, submitted a day or two later, reviewed and decided within weeks.
    v_t := r.start_at;
    update public.transfers t
       set created_at = v_t,
           submitted_at = case when t.submitted_at is not null then v_t + interval '1 day' * (1 + floor(random() * 2)) end,
           reviewed_at = case when t.reviewed_at is not null then v_t + interval '1 day' * (3 + floor(random() * 5)) end,
           decided_at = case when t.decided_at is not null then least(now(), v_t + interval '1 day' * (8 + floor(random() * 20))) end
     where t.id = r.transfer_id;
    update public.transfer_documents set uploaded_at = v_t + interval '2 hours' where transfer_id = r.transfer_id;
    update public.transfer_events e set at = case
             when e.kind in ('initiated', 'previous_owner', 'new_owner') then v_t
             when e.kind = 'document' then v_t + interval '2 hours'
             when e.kind = 'submitted' then t.submitted_at
             when e.kind in ('under_review', 'needs_documents') then t.reviewed_at
             else coalesce(t.decided_at, e.at) end
      from public.transfers t
     where t.id = r.transfer_id and e.transfer_id = r.transfer_id;
    update public.parcel_history h set at = case h.action when 'transfer_submitted' then t.submitted_at else t.decided_at end
      from public.transfers t
     where t.id = r.transfer_id and h.parcel_id = t.parcel_id and h.data ->> 'transfer_id' = r.transfer_id::text
       and h.action in ('transfer_submitted', 'transferred', 'transfer_rejected');
    -- The owners' "from" date and the land's history follow the decision date.
    update public.parcel_owners po set valid_from = (select t.decided_at::date from public.transfers t where t.id = r.transfer_id)
     where po.source_transfer_id = r.transfer_id;
    update public.parcel_owners po set valid_to = (select t.decided_at::date from public.transfers t where t.id = r.transfer_id)
     where po.ended_transfer_id = r.transfer_id;
    update private.demo_transfer_plan set done = true where transfer_id = r.transfer_id;
    n := n + 1;
  end loop;
  -- No SMS for made-up owners.
  delete from public.jobs j where j.kind like 'sms.%' and j.created_at = now();
  return jsonb_build_object('finished', n);
end;
$$;
revoke all on function private.demo_transfers_finish(uuid, int, int) from public, anon, authenticated;
