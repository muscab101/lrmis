-- Disputes, liens and court orders are no longer used: the "Court order" transfer type is switched off (kept for the
-- transfers that used it).
update public.transfer_types set active = false where works_as = 'court_order';
