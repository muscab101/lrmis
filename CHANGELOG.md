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
