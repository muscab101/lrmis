# Security review — Phase 12 (2026-10-16)

Scope: the database (migrations 0001–0025), the Next.js app (server actions, route handlers, middleware), and the integrations (payments, SMS, USSD, WhatsApp, assistant). Method: the Supabase security and performance advisors, a sweep of every `SECURITY DEFINER` function callable by `anon` or `authenticated`, and a review of every route under `app/api`.

## Results

| Area | Finding | Status |
| --- | --- | --- |
| RLS | Every table in `public` has RLS on. 7 tables have RLS on and no policy: `assessment_counters`, `idempotency_keys`, `invoice_tokens`, `jobs`, `provider_webhook_events`, `pun_counters`, `serial_counters`. | By design: only `SECURITY DEFINER` functions touch them. |
| Definer functions (anon) | 9 are callable without signing in: `application_track`, `invoice_by_token`, `location_tile`, `locations_extent`, `payment_intent_create`, `payment_intent_status`, `public_notices_active`, `setup_status`, `verify_document`. | Reviewed. Each needs a secret (tracking number + last 4 phone digits, a 64-character pay token, a 12-character verify code), or returns public data only. Verification shows initials only. |
| Definer functions (authenticated) | 140 RPCs. 11 had no visible check in their own body. | Reviewed. All are guarded through private helpers (`can_view_application`, `assert_surveyor`, `can_view_parcel`, `can_view_document`, `admin_authorize_user_action`, `admin_update_role`, `my_party`). |
| Service-only functions | Channel functions, `messages_claim`, `message_result`, `messages_requeue_stale`, `legacy_import_row`, `apply_late_penalties` | Execute revoked from `public`, `anon` and `authenticated`. Tests check this. |
| RLS performance | `billing_runs_select` and `messages_select` re-ran `auth.uid()` per row. | Fixed in 0024. |
| Foreign keys | 109 without an index. | 53 lookup keys indexed in 0024. The 56 left are audit `*_by` columns, never filtered on. |
| Leaked-password protection | Supabase Auth setting is off. | **Action for the project owner**: turn it on (Dashboard → Authentication → Passwords). The app already rejects breached passwords for staff. |
| Maker-checker | Approvals of transfers, parcel changes, permits, disputes, liens, orders, credit notes, plans, reversals, reprints, billing runs and campaigns. | Enforced in the database (`assert_maker_checker`); tests cover each one. |
| Webhooks | Payments (HMAC per provider), WhatsApp (`X-Hub-Signature-256`), dispatcher (bearer secret), USSD (callback key). | Timing-safe comparisons; forged requests get 401; payment events are idempotent on `(provider, event_id)`. |
| Exports | CSV exports neutralise formulas (`=`, `+`, `-`, `@`). | OK. |
| Secrets | Only in environment variables; `/admin/health` shows whether each is set, never its value. The test payment provider is disabled in the DB and refused in production. | OK. |
| Personal data | Phone numbers are masked in the outbox and logs. USSD/WhatsApp answer only for the caller's own phone. The assistant sends aggregates (and cashier names) to Anthropic — see open question 38. | Needs a data-protection decision before the assistant is switched on. |

## Before go-live
1. Turn on leaked-password protection in Supabase Auth.
2. Every active staff account enrols 2FA (`/admin/health` → "Active staff without 2FA" must be 0).
3. Rotate every secret that was used in development (service-role key, payment secrets, dispatcher, USSD, WhatsApp).
4. Set `PAYMENTS_TEST_MODE` off and confirm the `test` provider is disabled.
5. Commission an external penetration test of the public endpoints listed above.
