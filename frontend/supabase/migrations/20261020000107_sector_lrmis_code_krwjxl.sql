-- 0107 Kaaraan's hand-made sector Xaaji Laameer (Wajeer, 01) gets its LRMIS sector code, like the
-- other 391 Banaadir sectors loaded in 0103 (sectors.legacy_id = block code prefix, shown as the code).
update public.sectors t
   set legacy_id = 'KRWJXL'
  from public.sections s
  join public.districts d on d.id = s.district_id
 where t.section_id = s.id and d.code = '34' and s.code = '04' and t.code = '01' and t.legacy_id is null;
