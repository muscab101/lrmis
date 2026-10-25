-- 0104 Every neighbourhood holds 50 plots (user decision, 2026-10-25).
update public.neighbourhoods set capacity = 50 where capacity is distinct from 50;
