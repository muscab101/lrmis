-- Certificates are yearly now: one that has passed its tax year is "expired" (its own step so the new value can be used
-- in the next migration).
alter type public.issued_document_status add value if not exists 'expired';
