-- The certificate's yearly tax counts upper storeys (owner's report, 2026-11-23): a storey building's bill is area ×
-- building price + storeys × area × Upper Floors price (0272), but the certificate's Valuation box showed the land
-- part only. It now adds the upper storeys and keeps them as their own line. Certificates already issued for such land
-- and not printed yet are corrected; printed ones keep what they show (a reprint carries the right figure).

do $do$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('private.certificate_year_facts(uuid,integer)'::regprocedure);
  n := replace(d, $a$    v_tax := round(coalesce(v_area, 0) * v_grade.amount, 2);$a$,
                  $b$    v_tax := round(coalesce(v_area, 0) * v_grade.amount, 2)
             + case when v.parent_id is null then private.upper_storeys_amount(v.id) else 0 end;$b$);
  n := replace(n, $a$'floors', v.floors, 'area_m2', v_area, 'rate_m2', v_grade.amount, 'tax', v_tax);$a$,
                  $b$'floors', v.floors, 'area_m2', v_area, 'rate_m2', v_grade.amount, 'tax', v_tax,
                                      'upper_storeys', case when v.parent_id is null then coalesce(v.upper_storeys, 0) else 0 end,
                                      'upper_storeys_amount', case when v.parent_id is null then private.upper_storeys_amount(v.id) else 0 end);$b$);
  if n = d or position('upper_storeys_amount(v.id) else 0 end;' in n) = 0 or position('''upper_storeys_amount'', case' in n) = 0 then
    raise exception 'certificate_year_facts: anchor not found';
  end if;
  execute n;
end;
$do$;

-- Certificates already issued for storey buildings, not printed yet: the right yearly tax.
update public.issued_documents d
   set snapshot = jsonb_set(d.snapshot, '{valuation}',
         (d.snapshot -> 'valuation')
         || jsonb_build_object('tax', round((d.snapshot -> 'valuation' ->> 'tax')::numeric + private.upper_storeys_amount(p.id), 2),
                               'upper_storeys', p.upper_storeys, 'upper_storeys_amount', private.upper_storeys_amount(p.id)))
  from public.parcels p
 where p.id = d.parcel_id and d.type = 'certificate' and d.status = 'valid' and d.print_count = 0
   and p.parent_id is null and coalesce(p.upper_storeys, 0) > 0
   and d.snapshot ? 'valuation' and not (d.snapshot -> 'valuation' ? 'upper_storeys');
