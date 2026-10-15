-- Development / test seed. Production locations come from the legacy import (Phase 12).
-- District codes are placeholders until the official list is confirmed (Open question).

insert into public.regions (code, name_so, name_en)
values ('BN', 'Gobolka Banaadir', 'Banadir Region')
on conflict (code) do nothing;

insert into public.districts (region_id, code, name_so, name_en)
select r.id, d.code, d.name_so, d.name_en
from public.regions r
cross join (values
  ('ABZ', 'Cabdicasiis', 'Abdiaziz'),
  ('BDH', 'Boondheere', 'Bondhere'),
  ('DYN', 'Dayniile', 'Daynile'),
  ('DKL', 'Dharkenley', 'Dharkenley'),
  ('HJJ', 'Xamar Jajab', 'Hamar Jajab'),
  ('HWN', 'Xamar Weyne', 'Hamar Weyne'),
  ('HLW', 'Heliwaa', 'Heliwaa'),
  ('HDN', 'Hodan', 'Hodan'),
  ('HWD', 'Hawl Wadaag', 'Howlwadaag'),
  ('KRN', 'Kaaraan', 'Karan'),
  ('KXD', 'Kaxda', 'Kahda'),
  ('SHG', 'Shangaani', 'Shangani'),
  ('SHB', 'Shibis', 'Shibis'),
  ('WBR', 'Waaberi', 'Waberi'),
  ('WDJ', 'Wadajir', 'Wadajir'),
  ('WDL', 'Warta Nabadda', 'Wartanabada'),
  ('YQS', 'Yaaqshiid', 'Yaqshid'),
  ('GRB', 'Garasbaaley', 'Garasbaley'),
  ('GBD', 'Gubadley', 'Gubadley'),
  ('TRB', 'Tarabuunka', 'Tarabuunka'),
  ('DRS', 'Darusalaam', 'Darusalam'),
  ('MRK', 'Mursal', 'Mursal')
) as d(code, name_so, name_en)
where r.code = 'BN'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Phase 2 dev/test hierarchy (§10 Golden Path seed): 2 sections, 2 sectors,
-- 3 neighbourhoods with polygons. Shapes are APPROXIMATE TEST SQUARES, not official
-- boundaries — replace via Locations → Import GeoJSON. Marked legacy_id = 'DEV-SEED'.
-- ---------------------------------------------------------------------------
insert into public.sections (district_id, code, name_so, name_en, legacy_id, geom)
select d.id, s.code, s.name_so, s.name_en, 'DEV-SEED',
       extensions.st_multi(extensions.st_makeenvelope(s.x1, s.y1, s.x2, s.y2, 4326))
from (values
  ('HDN', 'T1', 'Qaybta Tijaabo Hodan', 'Hodan Test Section', 45.296, 2.030, 45.316, 2.046),
  ('WDJ', 'T1', 'Qaybta Tijaabo Wadajir', 'Wadajir Test Section', 45.270, 2.016, 45.290, 2.032)
) as s(dcode, code, name_so, name_en, x1, y1, x2, y2)
join public.districts d on d.code = s.dcode
on conflict (district_id, code) do nothing;

insert into public.sectors (section_id, district_id, code, name_so, name_en, legacy_id, geom)
select sec.id, sec.district_id, 'T1', 'Kaabta Tijaabo ' || d.name_so, d.name_en || ' Test Sector', 'DEV-SEED', sec.geom
from public.sections sec join public.districts d on d.id = sec.district_id
where sec.legacy_id = 'DEV-SEED'
on conflict (section_id, code) do nothing;

insert into public.neighbourhoods (sector_id, district_id, code, name_so, name_en, capacity, legacy_id, geom)
select sct.id, sct.district_id, n.code, n.name_so, n.name_en, 800, 'DEV-SEED',
       extensions.st_multi(extensions.st_makeenvelope(n.x1, n.y1, n.x2, n.y2, 4326))
from (values
  ('HDN', 'T01', 'Xaafadda Tijaabo 1', 'Test Neighbourhood 1', 45.296, 2.030, 45.306, 2.046),
  ('HDN', 'T02', 'Xaafadda Tijaabo 2', 'Test Neighbourhood 2', 45.306, 2.030, 45.316, 2.046),
  ('WDJ', 'T03', 'Xaafadda Tijaabo 3', 'Test Neighbourhood 3', 45.270, 2.016, 45.290, 2.032)
) as n(dcode, code, name_so, name_en, x1, y1, x2, y2)
join public.districts d on d.code = n.dcode
join public.sectors sct on sct.district_id = d.id and sct.legacy_id = 'DEV-SEED'
on conflict (district_id, code) do nothing;
