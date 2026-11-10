-- Collections by point of sale: every payment a cashier takes lands in their point of sale's account. Finance searches a
-- point of sale, sees its money (taken, approved, waiting) and each cashier's share, and approves a cashier's waiting
-- payments in one go. Approving uses payment_verify, so its rules stay: reconciliation.update, never your own takings,
-- reversed or reconciled payments can't be approved.

-- Points of sale with money in the period (or matching the search), with their cashiers.
create or replace function public.collections_by_pos(p_from date, p_to date, p_q text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v jsonb;
begin
  if not (public.has_permission('reconciliation.view') or public.has_permission('payments.approve')) then
    perform private.raise_app_error('PERMISSION_DENIED', 'reconciliation.view');
  end if;
  perform private.assert_report(p_from, p_to);
  with pays as (
    select p.pos_id, p.created_by as cashier_id, p.amount_base as amount, p.verify_status
      from public.payments p
     where p.status <> 'reversed' and p.pos_id is not null
       and p.received_at >= p_from and p.received_at < p_to + 1
       and private.can_view_payment(p.district_id, p.parcel_id)
  ), places as (
    select s.id, s.code, s.name, d.name_so as district_so, d.name_en as district_en
      from public.points_of_sale s
      left join public.districts d on d.id = s.district_id
     where (s.district_id is null or public.can_access_district(s.district_id))
       and (v_q is null or s.code ilike '%' || v_q || '%' or s.name ilike '%' || v_q || '%')
       and (v_q is not null or exists (select 1 from pays where pays.pos_id = s.id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'code', pl.code, 'name', pl.name, 'district_so', pl.district_so, 'district_en', pl.district_en,
      'payments', (select count(*) from pays where pays.pos_id = pl.id),
      'total', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id),
      'approved', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status in ('verified', 'reconciled')),
      'waiting', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status = 'pending'),
      'disputed', (select coalesce(sum(amount), 0) from pays where pays.pos_id = pl.id and verify_status = 'disputed'),
      'cashiers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cashier_id', c.cashier_id, 'cashier', pr.full_name, 'payments', c.payments, 'total', c.total,
                 'approved', c.approved, 'waiting', c.waiting, 'waiting_count', c.waiting_count, 'disputed', c.disputed)
               order by c.waiting desc, pr.full_name)
          from (select cashier_id, count(*) as payments, sum(amount) as total,
                       coalesce(sum(amount) filter (where verify_status in ('verified', 'reconciled')), 0) as approved,
                       coalesce(sum(amount) filter (where verify_status = 'pending'), 0) as waiting,
                       count(*) filter (where verify_status = 'pending') as waiting_count,
                       coalesce(sum(amount) filter (where verify_status = 'disputed'), 0) as disputed
                  from pays where pays.pos_id = pl.id group by cashier_id) c
          left join public.profiles pr on pr.user_id = c.cashier_id), '[]'::jsonb)
    ) order by pl.code), '[]'::jsonb)
    into v
    from places pl;
  return v;
end;
$$;
revoke all on function public.collections_by_pos(date, date, text) from public, anon;
grant execute on function public.collections_by_pos(date, date, text) to authenticated;

-- Approve every waiting payment one cashier took at one point of sale in the period. Returns how many were approved.
create or replace function public.pos_cashier_approve(p_pos uuid, p_cashier uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_n int := 0;
  v_i int := 1;
begin
  perform private.assert_permission('reconciliation.update');
  perform private.assert_report(p_from, p_to);
  select array_agg(p.id order by p.received_at) into v_ids
    from public.payments p
   where p.pos_id = p_pos and p.created_by = p_cashier and p.status <> 'reversed' and p.verify_status = 'pending'
     and p.received_at >= p_from and p.received_at < p_to + 1
     and private.can_view_payment(p.district_id, p.parcel_id);
  if v_ids is null then
    perform private.raise_app_error('CONFLICT', 'nothing_to_approve');
  end if;
  -- payment_verify takes at most 500 at a time.
  while v_i <= cardinality(v_ids) loop
    v_n := v_n + public.payment_verify(v_ids[v_i : v_i + 499], null);
    v_i := v_i + 500;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.pos_cashier_approve(uuid, uuid, date, date) from public, anon;
grant execute on function public.pos_cashier_approve(uuid, uuid, date, date) to authenticated;
