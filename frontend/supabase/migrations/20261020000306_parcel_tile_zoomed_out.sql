-- Zoomed-out land map (2026-11-28): at zoom 12–13 one tile covers most of the city and held ~40,000 pins (3 MB),
-- most of them drawn on the same few pixels. Now, at zoom 13 and below, pins that fall on the same spot (a 48-unit
-- cell of the 4096-unit tile, a few screen pixels) are sent once. From zoom 14 every pin is sent, as before.

do $do$
declare
  d text := pg_get_functiondef('public.parcel_tile(int,int,int)'::regprocedure);
  a1 text := $a$  select st_asmvt(t.*, 'parcel_pins') into v_pins from ($a$;
  a2 text := $a$      and (v_all or p.district_id = any (v_districts))) t;
  return coalesce(v, ''::bytea) || coalesce(v_pins, ''::bytea);$a$;
begin
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'parcel_tile: anchor not found';
  end if;
  d := replace(d, a1, $b$  select st_asmvt(t.*, 'parcel_pins') into v_pins from (
    select u.geom, u.id, u.pun, u.house_no, u.owing, u.demolished, u.partial from (
      select distinct on (k.cell) k.* from (
        select case when p_z <= 13 then st_astext(st_snaptogrid(w.geom, 48)) else w.id end as cell, w.*
        from ($b$);
  d := replace(d, a2, $b$      and (v_all or p.district_id = any (v_districts))) w
      ) k order by k.cell
    ) u
  ) t;
  return coalesce(v, ''::bytea) || coalesce(v_pins, ''::bytea);$b$);
  execute d;
end $do$;
