-- A new ID card is no longer billed automatically (owner decision 2026-10-31: not everyone wants the card printed).
-- When someone wants it, print staff press "Send to cashier" (card_send_to_cashier) or the cashier raises the bill
-- (card_print_bill); printing still waits for that bill to be paid while the id_card_print fee is on.
drop trigger if exists card_bill_on_issue on public.issued_documents;
drop function if exists private.card_bill_on_issue();
