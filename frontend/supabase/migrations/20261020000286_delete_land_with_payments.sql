-- Land and owners can be deleted (owner's report, 2026-11-25): an owner couldn't be deleted while holding land, and land
-- couldn't be deleted once anything was paid on it, so neither could go. Now:
-- * Land with payments can be deleted. Money stays on the books: paid and part-paid bills and their receipts are kept as
--   they are; only bills with nothing paid on them are cancelled.
-- * An owner linked to a portal account can be deleted; the account is unlinked (it then shows nothing).
-- An owner who still holds land (not deleted) still can't be deleted: delete or transfer the land first.

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('private.parcel_delete_one(uuid,text)'::regprocedure);
  n := replace(d, $a$  -- Money received stays on the books: such land can't be deleted.
  if exists (select 1 from public.invoices i where i.parcel_id = p_id and i.status <> 'cancelled' and (i.paid > 0 or i.credited > 0))
     or exists (select 1 from public.payments pm where pm.parcel_id = p_id and pm.status <> 'reversed') then
    perform private.raise_app_error('CONFLICT', 'has_payments');
  end if;
  update public.invoices set status = 'cancelled', cancel_reason = 'Land deleted: ' || trim(p_reason)
   where parcel_id = p_id and status not in ('cancelled', 'paid');$a$,
                  $b$  -- Money received stays on the books: bills with anything paid on them, and their receipts, are kept as they are.
  update public.invoices set status = 'cancelled', cancel_reason = 'Land deleted: ' || trim(p_reason)
   where parcel_id = p_id and status not in ('cancelled', 'paid') and paid = 0 and credited = 0;$b$);
  if n = d then
    raise exception 'parcel_delete_one: anchor not found';
  end if;
  execute n;

  d := pg_get_functiondef('public.party_delete(uuid,text)'::regprocedure);
  n := replace(d, $a$  if v.citizen_user_id is not null then
    perform private.raise_app_error('CONFLICT', 'citizen_account');
  end if;$a$, '');
  n := replace(n, $a$  update public.parties set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id;$a$,
                  $b$  -- A portal account linked to this owner is unlinked (it stays, showing nothing).
  update public.parties set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(trim(coalesce(p_reason, '')), ''),
         citizen_user_id = null
   where id = p_id;$b$);
  if n = d or position('citizen_account' in n) > 0 or position('citizen_user_id = null' in n) = 0 then
    raise exception 'party_delete: anchor not found';
  end if;
  execute n;
end;
$do$;
