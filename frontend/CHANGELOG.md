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
