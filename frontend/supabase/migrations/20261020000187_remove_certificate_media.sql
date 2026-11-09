-- Certificates are protected by the LRMIS desktop app (its window comes out black in screenshots), not by DRM video,
-- so the video job list from 20261020000186 is removed. Its storage bucket was emptied and deleted through the
-- storage API.
drop trigger if exists certificate_media_queue on public.issued_documents;
drop function if exists private.certificate_media_queue();
drop function if exists public.certificate_media_claim(text);
drop function if exists public.certificate_media_job(text);
drop function if exists public.certificate_media_done(text, boolean, text, text, text);
drop table if exists public.certificate_media;
drop function if exists private.certificate_media_hash(public.issued_documents);
