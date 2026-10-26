-- District collections also say what each district holds per money account (cash, mobile money, card), so a deposit
-- starts from the account that actually has the money (a deposit can't take more than the account holds).
drop function if exists public.accounting_districts(date, date);

/**
 * Collections from each district the viewer may see, for [p_from, p_to]: billed, collected (and by cash, mobile
 * money, card, bank transfer), deposited to the bank, what the district still holds (cash, mobile money and card
 * not yet deposited, at p_to, in total and per account) and what is still owed on open invoices today.
 */
create or replace function public.accounting_districts(p_from date, p_to date)
returns table (district_id uuid, code text, name_so text, name_en text, billed numeric, collected numeric, cash numeric, mobile numeric,
               card numeric, bank numeric, deposited numeric, held numeric, owed numeric, pending_deposits numeric, held_accounts jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_permission('accounting.view');
  return query
  select d.id, d.code, d.name_so, d.name_en,
         coalesce((select sum(i.total) from public.invoices i where i.district_id = d.id and i.status <> 'cancelled' and i.issue_date between p_from and p_to), 0),
         coalesce(p.total, 0), coalesce(p.cash, 0), coalesce(p.mobile, 0), coalesce(p.card, 0), coalesce(p.bank, 0),
         coalesce((select sum(m.amount) from public.money_movements m where m.district_id = d.id and m.kind = 'deposit' and m.status = 'confirmed'
                    and m.movement_date between p_from and p_to), 0),
         coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                    join public.gl_accounts a on a.code = l.account
                   where l.district_id = d.id and a.type = 'asset' and a.code like '11__' and not a.is_bank and e.entry_date <= p_to), 0),
         coalesce((select sum(i.balance) from public.invoices i where i.district_id = d.id and i.status in ('issued', 'partially_paid')), 0),
         coalesce((select sum(m.amount) from public.money_movements m where m.district_id = d.id and m.kind = 'deposit' and m.status = 'pending'), 0),
         coalesce((select jsonb_object_agg(h.account, h.amount) from (
                    select l.account, sum(l.debit - l.credit) amount from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                      join public.gl_accounts a on a.code = l.account
                     where l.district_id = d.id and a.type = 'asset' and a.code like '11__' and not a.is_bank and e.entry_date <= p_to
                     group by l.account having sum(l.debit - l.credit) <> 0) h), '{}'::jsonb)
  from public.districts d
  left join lateral (
    select sum(x.amount_base) total,
           sum(x.amount_base) filter (where x.method in ('cash', 'cheque')) cash,
           sum(x.amount_base) filter (where x.method = 'mobile_money') mobile,
           sum(x.amount_base) filter (where x.method = 'card') card,
           sum(x.amount_base) filter (where x.method = 'bank_transfer') bank
    from public.payments x where x.district_id = d.id and x.status <> 'reversed' and x.received_at::date between p_from and p_to) p on true
  where public.can_access_district(d.id)
  order by coalesce(p.total, 0) desc, d.code;
end;
$$;

revoke all on function public.accounting_districts(date, date) from public, anon;
grant execute on function public.accounting_districts(date, date) to authenticated;
