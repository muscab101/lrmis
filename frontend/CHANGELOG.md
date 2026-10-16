# Changelog

## Phase 1 — Foundation (2026-10-15)

- Monorepo: `apps/web` (Next.js 15), `packages/core` (permissions, Zod schemas, error codes, password policy), `packages/ui` (tokens + components).
- Supabase migrations: platform tables, permission catalog (25 modules × 8 actions + 8 special), 23 default roles, RLS on every table, audit trigger (append-only), admin RPCs with escalation / last-Super-Admin / self-action guards, login lockout, idempotency keys, access-token hook, Realtime for notifications.
- Auth: staff email + password with lockout and breach check, Google for existing staff only, TOTP 2FA enforced in the DB, citizen phone OTP, forgot/reset/forced change password, invite links, idle timeout, forced JWT refresh on role change.
- Super Admin bootstrap: `pnpm create-super-admin` and self-locking `/setup`.
- Admin panel: users (list with URL filters, CSV export, create with password-shown-once or invite, edit roles/districts, suspend/reactivate, force sign-out, reset 2FA, set password / reset link, soft/hard delete with password re-entry, activity), roles (list with user counts, create/copy/edit with permission matrix, data scope, limits, reset to default, delete with move-users), permission catalog, login history, audit log viewer, settings (read-only).
- App shell: collapsible grouped sidebar (permission-aware), ⌘K, language switch (so/en), theme, live notifications, user menu, DEV/STAGING badge, mobile drawer. `/design` component gallery.
- Tests: 29 DB tests in PGlite against the real migrations, core unit tests, i18n key-coverage test, Playwright smoke + admin golden path (§10 step 11). GitHub Actions CI.

## Phase 2 — Locations & map (2026-10-16)

- Migrations 0011–0012: sections, sectors, neighbourhoods (code unique per district, used in the PUN), streets, facilities; district kept in sync down the hierarchy; RLS with district-scoped writes; archive instead of delete; GIST + trigram indexes; geometry import from GeoJSON with repair and validation; `locate_point`, `search_neighbourhoods`, `location_geojson`; vector tiles from PostGIS (`location_tile`, ST_AsMVT) served at `/api/tiles/{layer}/{z}/{x}/{y}`; `has_geom` flags.
- `/map`: MapLibre map with streets/satellite base maps (MapTiler when `NEXT_PUBLIC_MAPTILER_KEY` is set, else OSM + Esri), boundary layers, legend, neighbourhood search, click-for-details, view in the URL.
- `/locations`: all six levels with district filter, search, archived view, create/edit with cascading pickers, boundary import with map preview.
- Dev seed: 2 sections, 2 sectors, 3 test neighbourhoods with APPROXIMATE test squares (legacy_id `DEV-SEED`).

## Phase 3 — Owners, applications, documents (2026-10-16)

- Migration 0013: parties (persons/organisations, unique ID document), applications (APP-YYYY-NNNNNN), owners with roles and shares, typed document checklist, private `application-documents` bucket, event history; all writes through checked RPCs; RLS by district and by applicant; duplicate check (same ID, same phone, similar name + mother's name, other pins within 10 m) that never reveals other people's data to citizens; public tracking by number + last 4 phone digits.
- `/owners` (list, new, detail, edit), `/applications` (status tabs with counts, filters, search), `/applications/new`, `/applications/[id]` (details with map pin, owners & shares, documents upload/view, review & submit, return/reject/cancel with reasons, history).
- Citizen portal: my applications, apply online (applicant becomes 100% owner), application page; public `/track`.
- Tests: PGlite now runs real PostGIS; 58 database tests (RBAC, locations, applications).
- Not yet: application fee invoice/payment (Phase 7) — submitted applications wait at "Awaiting payment".

## Phase 4 — Survey, verification, public notice, registration & PUN (2026-10-16)

- Migration 0014: parcels (PostGIS polygon, centroid, status), parcel owners and history, surveys and survey photos (private `survey-photos` bucket), public notices and objections, application fee status. Flow: fee paid or waived (finance, maker-checker) → surveyor assigned (least busy in the district, or chosen) → boundary saved and submitted (strict validity, minimum area, neighbourhood containment, overlap check against existing parcels) → GIS overlap review when needed → land officer checklist → 14-day public notice (closed daily by pg_cron) → registrar registers: gapless per-district PUN (`BN-<district>-<neighbourhood>-<serial:6>`) and account number, owners copied from the application. Open or upheld objections block registration; the verifier and the surveyor can't sign off their own work.
- Migration 0015: Legal Officer and Finance Manager can read applications in their districts (needed to decide objections and waive fees on the application page).
- Parcel vector tiles at `/api/parcel-tiles/{z}/{x}/{y}` (district-scoped, coloured by status); parcels layer + click panel on `/map`.
- `/surveys` work queue (status tabs, "mine") and `/surveys/[id]` workspace: draw the boundary on satellite imagery (corners snap to neighbouring parcels), edit corners, GPS walk mode, live area/perimeter, self-intersection warning, neighbours N/E/S/W, building details, notes, photos with GPS, autosave, submit with overlap results, GIS accept/return.
- Application page: progress panel for fee waiver, surveyor assignment, verification checklist, notice with objections (record, dismiss, uphold), registration with land use, and the parcel on a map.
- `/parcels` search (PUN, account, owner) and parcel page (facts, owners, history, map). Public `/notices` board with objection filing for signed-in users.
- Tests: 70 database tests including the full Phase 4 golden path.

## Phase 5 — Valuation, rates, assessments, appeals (2026-10-16)

- Migration 0017: property grades (villa, storey, brick house, cariish, baraako, jiingad, shop, warehouse) and fee types with pay intervals; neighbourhood rates per land use and developed/undeveloped with `valid_from` history (past rates are never edited); buildings on parcels; exemptions (mosque, school, hospital, government, hardship) with maker-checker approval; assessments numbered `ASM-<year>-<serial>` with a stored breakdown, one live assessment per parcel and year; appeals (owner or staff on their behalf) that block re-assessment while open and, when upheld, issue a corrected assessment.
- Formula (§4.6): `rate[use][developed] × area + Σ(grade amount × units) − exemption % of (land + buildings) + service charge`; the rate in force on 1 January applies; with no neighbourhood rate the `valuation.default_rate_m2` setting is used.
- `/valuation`: assessments (search, year, assess a whole neighbourhood), rates (history per neighbourhood, add rate), property grades and fee types (add/edit), exemptions and appeals queues with decisions.
- Parcel page: valuation card with buildings, live tax calculation for a chosen year, issue assessment, assessment history, exemption request and appeal recording.
- Tests: 78 database tests (8 new for valuation). Anonymous callers can't execute any valuation RPC.

## Phase 6 — Billing runs, invoices, penalties, payment plans (2026-10-16)

- Migration 0018: billing runs (`BR-<year>-<n>`: draft with preview → submitted → approved by someone else → generate → issued, or cancelled with a reason); invoices (`INV-<year>-<n>`) with lines, generated balance and status, **unique (parcel, fee type, period)** so generation is idempotent; one-off fee invoices; credit notes (`CN-`) with maker-checker approval; one-time late penalty after due date + grace (daily pg_cron job), skipped for invoices in a pending/active plan; early-payment discount window stored on each invoice for Phase 7; payment plans (`PP-`) with equal monthly instalments and approval; SMS jobs queued per invoice.
- Each invoice has a secret 64-character pay token in a locked table; `/pay/[token]` (public) shows only number, PUN, period, amount due and how to pay. `private.invoice_apply_payment()` is the hand-off for Phase 7 payments.
- `/billing/runs` (KPIs, new-run wizard, list), `/billing/runs/[id]` (preview with exceptions, submit / approve / generate / cancel, generated invoices), `/invoices` (open / overdue / paid / cancelled, search by number or PUN; credit-note and payment-plan queues), `/invoices/[id]` (lines, totals, discount, credit notes, plans; print, plan, credit note, cancel), printable A4 invoice with QR code, invoices card on the parcel page.
- Tests: 88 database tests (10 new for billing).

## Phase 7 — Payments, cashier, reconciliation, accounting (2026-10-16)

- Migration 0019: currencies (USD, SOS) and daily rates; chart of accounts; fiscal periods (lockable); journal entries/lines posted automatically and always balanced — invoice lines (Dr debtors / Cr income; contra Dr 5100), cancellations, payments (Dr cash/mobile/card/bank clearing / Cr debtors + customer credit), reversals (mirrored), matching and credit application; manual journals for accountants; trial balance.
- Payments: receipt numbers per point of sale, oldest-invoice-first allocation (or a chosen invoice), partial payments, overpayment kept as customer credit, early-payment discount when the balance is settled in the window, payment-plan instalments updated and plans completed; SOS converted at the day's rate (refused without one).
- Cashier: one open shift per cashier at a point of sale, take payments by PUN, close with counted cash (expected = float + cash taken; large differences need a note), approval by someone else.
- Online: payment intents from the invoice QR page (anonymous, rate-limited) or by staff/owners; provider adapters (`PaymentProvider`: WaafiPay API_PURCHASE push, Stripe Checkout, development test provider); `/api/payments/webhook/[provider]` verifies signatures (HMAC; Stripe's t/v1 scheme) and calls `webhook_ingest`, which stores every event, is idempotent on (provider, event id) and provider reference, matches money by intent or PUN reference and otherwise queues it as unmatched.
- Reversals (request → second-person approval), unmatched-payment matching, bank/cheque recording, settlement-report reconciliation (matched / amount differs / missing on either side), provider on/off switches.
- Pages: `/payments` (payments, unmatched, reversals, cashier shifts, reconciliation, providers), `/payments/[id]`, printable 80 mm receipt, `/cashier`, `/accounting` (trial balance, journal, accounts, exchange rates, periods), "Pay now" on `/pay/[token]`.
- Tests: 100 database tests (12 new: ledger balanced after every step, debtors = open invoices, discount, credit, SOS, shifts, webhooks, unmatched, reversals, reconciliation, period lock). Verified on Supabase: cash and test-provider payments, webhook route (signed 200, duplicate, forged 401).

## Phase 8 — Certificates, ID cards, printing, verification (2026-10-16)

- Migration 0020: issued documents (title certificates `CERT-<year>-<n>`, property ID cards `IDC-<year>-<n>` per owner, 5-year expiry) with a frozen snapshot of the register at issue time (owners, PUN, area, use, centroid, geometry, adjacent parcels, survey boundaries, registrar); 12-character verification codes; one valid certificate per parcel and one valid card per owner (partial unique indexes).
- Eligibility (configurable): registered, not disputed, no open/upheld objection, an owner on record, and nothing left to pay (`certificates.require_full_payment`, otherwise nothing overdue).
- Print log: the first print is recorded once; later prints need a reprint request (reason + certificate-fee invoice), approval by someone else after the fee is paid, which cancels the old document and issues a new serial. Cancellation with reason (maker-checker).
- Public `verify_document`: valid / cancelled / expired / not found, with initials only — no ID numbers, phones or geometry.
- Pages: `/documents/print` (to issue with eligibility, to print, issued, reprints), `/documents/[id]` (print log, reprint, cancel), print page with A4 certificate (emblem, owners table, facts, scale-true map extract with neighbours, north arrow and scale bar, boundaries, corner coordinates, e-signature, QR) and CR80 ID card front/back; on-screen PREVIEW watermark until the official print is logged; public `/verify` and `/verify/[code]`; certificate card on the parcel page.
- Tests: 106 database tests (6 new). Verified on Supabase: CERT-2026-000001 + IDC-2026-000001 issued for the paid test parcel; public verify page checked in the browser.

## Phase 9 — Transfers, disputes, encumbrances, parcel changes, permits, leases (2026-10-16)

- Migration 0021: disputes `DSP-`, court orders (freeze / transfer / release), liens and mortgages, transfers `TRF-` (sale, gift, inheritance, court order) with frozen from/to owner lists, parcel changes `PCH-` (subdivision, merge, change of use), building permits `PRM-` with a fee invoice, leases of public land `LSE-`. RLS by parcel visibility; every write through checked RPCs.
- One blocker check (`private.parcel_blockers`) used everywhere: open dispute, freeze order, active lien, unpaid balance, pending change, archived, not registered.
- Transfers: draft → submitted (stamp duty invoice: `transfers.stamp_duty_pct` of the declared value, fixed duty for inheritance) → approved by a second officer once the duty is paid. Old owners are closed and new ones opened with shares totalling 100 %, and the parcel's documents are cancelled for reissue.
- Subdivision: child polygons must be valid, inside the parent, non-overlapping and within 1 % of its area. On approval the parent is archived and children get new PUNs and the same owners. Merge needs touching parcels in one neighbourhood with identical owners. Change of use updates the land use. All maker-checker.
- Pages: `/transfers` (status tabs) and `/transfers/[id]` (owners before/after, duty, submit/approve/reject/cancel); `/disputes` (disputes, active liens, active court orders, parcel change approvals); `/permits` (approve with conditions, validity from `permits.valid_months`); `/parcels/[id]/subdivide` (Terra Draw editor that snaps to the parent's corners and shows live areas); a Legal card on the parcel page with blockers and all actions. Blocker errors list the reasons in plain words.
- Tests: 116 database tests (10 new). Verified on Supabase: a lien blocks transfer and subdivision, and releasing it clears the blockers.

## Phase 10 — Dashboards, reports, messages, assistant (2026-10-16)

- Migration 0022: SMS outbox (`messages`) with templates in Somali and English, retries with growing back-off, stale-claim recovery (pg_cron), and dedupe keys so an event never texts twice. Event messages: application steps (also in-app), payment receipts, certificate ready. Officers get an in-app notice when their transfer, permit or parcel change is decided.
- Campaigns `MSG-`: overdue reminders (minimum days overdue), tax-due notices by year, or a free-text notice to all registered owners in a district. Preview shows the count and a sample. A second officer (`messages.approve`, now on Admin) approves before anything is queued. Limit `messages.campaign_limit`.
- Dashboard (`dashboard_kpis`): collections this month and year, outstanding, overdue, collection rate, six-month trend, registry counts, and a "Waiting for you" list (surveys, approvals, campaigns, failed messages). Everything is limited to the user's districts and permissions.
- Reports (`/reports`): revenue by month and fee type, arrears ageing by district, collection rate, registrations with median days, cashier takings and differences. Date and district filters, CSV export (`reports.export`, formula-safe). The report functions check permission and districts themselves, so executives see totals without row access.
- Reporting assistant on `/reports`: Claude answers questions using only the report functions, run as the signed-in user; off unless `ANTHROPIC_API_KEY` is set; 30 questions per user per hour.
- `/messages`: outbox (masked numbers, retry, cancel), campaigns (create, approve or reject), templates (edit both languages, switch off).
- `/api/messages/dispatch`: sends queued SMS through the configured provider (`SMS_PROVIDER=twilio`, or `log` in development only), behind a bearer secret. Run it every minute from a scheduler.
- Tests: 122 database tests (6 new). Verified on Supabase: dashboard and report figures match the ledger (353.24 collected, 100 % collection); a queued test message was claimed, sent through the log provider and marked sent.

## Phase 11 — Citizen portal, USSD, WhatsApp (2026-10-16)

- Migration 0023: `citizen_overview` gives the signed-in owner their parcels (place, use, share, balance, overdue), bills with pay links, valid documents with verify codes, receipts and SMS in one call. Channel functions (service role only) answer only about records linked to the caller's own phone number: balance, open bills, application status, a pay link by SMS (`pay_link`, once an hour per bill), WhatsApp replies via the outbox. Per-phone limit `channels.hourly_limit` (30 an hour); requests are logged for 90 days. `site.public_url` sets the address used in links.
- Portal: home now shows property cards (amount to pay, overdue, Pay now, title issued), applications, receipts, messages, and how to use USSD and WhatsApp. New `/portal/parcels/[id]` page with map, bills, documents (verify links) and receipts.
- USSD `/api/ussd` (Africa's Talking-style `CON`/`END`, `?key=` callback secret): 1 balance, 2 pay (pick a bill, get an SMS link), 3 track application, 4 verify certificate, 5 switch Somali/English.
- WhatsApp `/api/whatsapp/webhook` (Cloud API, verify token + `X-Hub-Signature-256`): BALANCE/HARAA, PAY/BIXI, TRACK/RAADI, VERIFY/HUBI, with replies in the language of the keyword. Replies go out through the dispatcher's WhatsApp provider (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`).
- Tests: 128 database tests (6 new). Checked against Supabase through the dev server: every USSD menu path in both languages, a stranger's number, the certificate check, signed and forged WhatsApp calls, and both replies sent by the log provider.

