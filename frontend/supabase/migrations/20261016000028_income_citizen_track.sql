-- ============================================================================
-- 0028 Income and outgoings from the ledger (for reports, dashboard and the assistant),
-- and the citizen's own applications with their history (portal tracking + assistant).
-- ============================================================================

/**
 * Per month: income earned (4xxx), expenses and write-downs (5xxx), money received
 * (debits to cash/mobile/card/bank 11xx) and money paid out (credits to 11xx: refunds, reversals).
 */
create or replace function public.report_income_expense(p_from date, p_to date, p_district uuid default null)
returns table (month text, income numeric, expenses numeric, cash_in numeric, cash_out numeric, net numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := private.user_has_all_districts(auth.uid());
begin
  perform private.assert_report(p_from, p_to);
  return query
    with lines as (
      select to_char(e.entry_date, 'YYYY-MM') m, l.account, l.debit, l.credit
        from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
       where e.entry_date between p_from and p_to
         and (case when l.district_id is null then v_all else public.can_access_district(l.district_id) end)
         and (p_district is null or l.district_id = p_district)
    ), months as (
      select to_char(m, 'YYYY-MM') m from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
    )
    select months.m,
           coalesce(sum(l.credit - l.debit) filter (where l.account like '4%'), 0),
           coalesce(sum(l.debit - l.credit) filter (where l.account like '5%'), 0),
           coalesce(sum(l.debit) filter (where l.account like '11%'), 0),
           coalesce(sum(l.credit) filter (where l.account like '11%'), 0),
           coalesce(sum(l.debit) filter (where l.account like '11%'), 0) - coalesce(sum(l.credit) filter (where l.account like '11%'), 0)
      from months left join lines l on l.m = months.m
     group by months.m
     order by 1;
end;
$$;

/** Totals per ledger account for the period (income and expense accounts first). */
create or replace function public.report_accounts(p_from date, p_to date)
returns table (code text, name_so text, name_en text, type text, debit numeric, credit numeric, net numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := private.user_has_all_districts(auth.uid());
begin
  perform private.assert_report(p_from, p_to);
  return query
    select a.code, a.name_so, a.name_en, a.type::text, coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0),
           case when a.type::text in ('income', 'liability', 'equity') then coalesce(sum(l.credit - l.debit), 0) else coalesce(sum(l.debit - l.credit), 0) end
      from public.gl_accounts a
      left join public.journal_lines l on l.account = a.code
        and exists (select 1 from public.journal_entries e where e.id = l.entry_id and e.entry_date between p_from and p_to)
        and (case when l.district_id is null then v_all else public.can_access_district(l.district_id) end)
     group by a.code, a.name_so, a.name_en, a.type
     order by case a.type::text when 'income' then 1 when 'expense' then 2 when 'asset' then 3 else 4 end, a.code;
end;
$$;

grant execute on function public.report_income_expense(date, date, uuid), public.report_accounts(date, date) to authenticated;
revoke execute on function public.report_income_expense(date, date, uuid), public.report_accounts(date, date) from public, anon;

/** The citizen's applications (as applicant or co-owner) with their history, newest first. */
create or replace function public.citizen_applications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select id from public.parties where citizen_user_id = auth.uid() and deleted_at is null),
  apps as (
    select a.* from public.applications a
     where a.citizen_user_id = auth.uid()
        or a.applicant_party_id in (select id from me)
        or exists (select 1 from public.application_parties ap where ap.application_id = a.id and ap.party_id in (select id from me))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'number', a.number, 'type', a.type, 'status', a.status, 'channel', a.channel,
      'created_at', a.created_at, 'submitted_at', a.submitted_at, 'decided_at', a.decided_at,
      'district', (select jsonb_build_object('name_so', d.name_so, 'name_en', d.name_en) from public.districts d where d.id = a.district_id),
      'pun', (select p.pun from public.parcels p where p.application_id = a.id limit 1),
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'to', e.to_status, 'at', e.at) order by e.at desc)
                 from (select * from public.application_events e where e.application_id = a.id order by at desc limit 15) e), '[]'::jsonb)
    ) order by a.created_at desc), '[]'::jsonb)
  from apps a;
$$;
grant execute on function public.citizen_applications() to authenticated;
revoke execute on function public.citizen_applications() from public, anon;

/** Fees anyone may know (for the citizen assistant and the portal). */
create or replace function public.public_fee_schedule()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_so', name_so, 'name_en', name_en, 'interval', interval, 'amount', amount) order by sort, code), '[]'::jsonb)
    from public.fee_types where active;
$$;
grant execute on function public.public_fee_schedule() to authenticated;
revoke execute on function public.public_fee_schedule() from public, anon;
