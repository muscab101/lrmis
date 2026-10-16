-- 0016 Rename the product to LRMIS (Land Registration & Management Information System).
update public.settings
   set value = '{"so": "LRMIS — Gobolka Banaadir", "en": "LRMIS — Banadir Regional Administration"}'::jsonb
 where key = 'app.name';
