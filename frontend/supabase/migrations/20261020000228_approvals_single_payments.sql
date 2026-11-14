-- Applications: payments that came in with no cashier (online), waiting to be approved one by one, are listed too, so
-- payments are approved only on Applications.
do $$
declare
  d text := pg_get_functiondef('public.approvals_inbox()'::regprocedure);
  a text := '  if public.has_permission(''accounting.approve'') then';
  b text := '  if public.has_permission(''reconciliation.update'') then
    v_items := v_items || coalesce((select jsonb_agg(x) from (
      select jsonb_build_object(''kind'', ''payment'', ''id'', p.id, ''ref'', p.receipt_no, ''title'', p.payer_name, ''detail'', p.note,
        ''amount'', p.amount_base, ''by_id'', null, ''by'', null, ''at'', p.received_at, ''href'', ''/payments/'' || p.id, ''district_id'', p.district_id,
        ''facts'', jsonb_strip_nulls(jsonb_build_object(''method'', p.method, ''provider'', p.provider, ''reference'', coalesce(p.provider_ref, p.reference),
          ''phone'', p.payer_phone, ''pun'', (select pa.pun from public.parcels pa where pa.id = p.parcel_id), ''received_date'', p.received_at))) x
        from public.payments p
       where p.verify_status = ''pending'' and p.status <> ''reversed'' and p.created_by is null
         and private.can_view_payment(p.district_id, p.parcel_id)
       limit 300) t(x)), ''[]''::jsonb);
  end if;

  if public.has_permission(''accounting.approve'') then';
  d2 text := pg_get_functiondef('public.approval_decide(text,uuid,boolean,text,jsonb)'::regprocedure);
  a2 text := '    when ''movement'' then';
  b2 text := '    when ''payment'' then perform public.payment_verify(array[p_id], v_note);
    when ''movement'' then';
  a3 text := '''commission_rule'', ''pos_payments'')';
  b3 text := '''commission_rule'', ''pos_payments'', ''payment'')';
begin
  if position(a in d) = 0 or position(a2 in d2) = 0 or position(a3 in d2) = 0 then
    raise exception 'approvals: anchors not found';
  end if;
  execute replace(d, a, b);
  execute replace(replace(d2, a2, b2), a3, b3);
end $$;
