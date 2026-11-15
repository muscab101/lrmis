-- No automatic early-payment discount: new bills get none, and the open bills that had one lose it (none was used).
update public.settings set value = to_jsonb(0), description = 'Early-payment discount % on yearly bills (0 = none)'
 where key = 'billing.early_discount_pct';
update public.invoices set early_discount_pct = 0, discount_until = null
 where status in ('issued', 'partially_paid') and (coalesce(early_discount_pct, 0) <> 0 or discount_until is not null)
   and paid = 0
   and not exists (select 1 from public.parcels p where p.id = invoices.parcel_id and p.building_state = 'demolished');
