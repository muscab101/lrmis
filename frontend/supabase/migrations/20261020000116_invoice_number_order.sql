-- Lists keep a tax bill and its service charge together (INV-2026-000018, then SV-2026-000018): order by the number
-- without its prefix, then the prefix.
alter table public.invoices add column if not exists number_key text generated always as (regexp_replace(number, '^[A-Z]+-', '')) stored;
create index if not exists invoices_number_key_idx on public.invoices (number_key desc, number);
