-- A sale or gift no longer asks for a declared value (the form field was removed). Without one, stamp duty is the
-- minimum (transfers.stamp_duty_min).
create or replace function public.transfer_create(p_parcel uuid, p_kind public.transfer_kind, p_value numeric, p_court_order uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.parcels;
  v_id uuid;
begin
  perform private.assert_permission('transfers.create');
  v := private.scoped_parcel(p_parcel);
  if p_value is not null and p_value < 0 then
    perform private.raise_app_error('VALIDATION', 'declared_value');
  end if;
  if p_kind = 'court_order' and not exists (select 1 from public.court_orders where id = p_court_order and parcel_id = p_parcel and active and kind = 'transfer') then
    perform private.raise_app_error('VALIDATION', 'court_order');
  end if;
  insert into public.transfers (number, parcel_id, district_id, kind, declared_value, court_order_id, from_owners, note, created_by)
  values (private.serial('TRF'), p_parcel, v.district_id, p_kind, p_value, p_court_order,
          coalesce((select jsonb_agg(jsonb_build_object('party_id', po.party_id, 'full_name', pa.full_name, 'role', po.role, 'share_pct', po.share_pct))
                    from public.parcel_owners po join public.parties pa on pa.id = po.party_id where po.parcel_id = p_parcel and po.valid_to is null), '[]'::jsonb),
          nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform private.raise_app_error('CONFLICT', 'transfer_open');
end;
$$;
