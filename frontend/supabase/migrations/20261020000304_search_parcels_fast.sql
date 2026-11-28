-- Faster land search (2026-11-28): with 65,000 pieces of land, searching by an owner's name took ~30 s, because every
-- piece of land was tested against the words (its owners, applicants and bills, one by one, each through the access
-- rules). Now the matches are found first — owner and applicant names through the name index (parties_name_trgm),
-- bill and application numbers, PUN, account, house and receipt numbers — and only that land is listed. Same results,
-- same access rules (the function still runs as the caller).

do $do$
declare
  d text := pg_get_functiondef('public.search_parcels(text,integer,text,uuid)'::regprocedure);
  a1 text := $a$  ), picked as ($a$;
  a2 text := $a$       and (coalesce(trim(p_q), '') = ''
            or (p.pun ilike '%' || trim(p_q) || '%' or coalesce(p.pun_old, '') ilike '%' || trim(p_q) || '%')
            or p.account_no ilike trim(p_q) || '%'
            or p.house_no ilike trim(p_q) || '%'
            or p.govt_receipt_no ilike trim(p_q) || '%'
            or a.number ilike trim(p_q) || '%'
            or exists (select 1 from public.invoices i where i.parcel_id = p.id and i.number ilike trim(p_q) || '%')
            or exists (select 1 from public.parcel_owners po join public.parties pa on pa.id = po.party_id
                        where po.parcel_id = p.id and po.valid_to is null and pa.full_name ilike '%' || trim(p_q) || '%')
            or exists (select 1 from public.application_parties ap join public.parties pa on pa.id = ap.party_id
                        where ap.application_id = p.application_id and pa.full_name ilike '%' || trim(p_q) || '%'))$a$;
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'search_parcels: anchor not found';
  end if;
  d := replace(d, a1, $b$  ), words as (
    select nullif(trim(coalesce(p_q, '')), '') as t
  ), names as (
    -- Owners and applicants whose name has the words (name index), found once.
    select pa.id from public.parties pa, words w where w.t is not null and pa.full_name ilike '%' || w.t || '%'
  ), hits as (
    -- Every piece of land the words point to.
    select p.id from public.parcels p, words w
     where w.t is not null
       and (p.pun ilike '%' || w.t || '%' or coalesce(p.pun_old, '') ilike '%' || w.t || '%'
            or p.account_no ilike w.t || '%' or p.house_no ilike w.t || '%' or p.govt_receipt_no ilike w.t || '%')
    union
    select p.id from public.applications a join public.parcels p on p.application_id = a.id, words w
     where w.t is not null and a.number ilike w.t || '%'
    union
    select i.parcel_id from public.invoices i, words w where w.t is not null and i.number ilike w.t || '%'
    union
    select po.parcel_id from names n join public.parcel_owners po on po.party_id = n.id and po.valid_to is null
    union
    select p.id from names n join public.application_parties ap on ap.party_id = n.id
      join public.parcels p on p.application_id = ap.application_id
  ), picked as ($b$);
  d := replace(d, a2, $b$       and (coalesce(trim(p_q), '') = '' or p.id in (select h.id from hits h))$b$);
  execute d;
end $do$;
