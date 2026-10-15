# Dhulka — Land Registry, Property Tax & GIS (Gobolka Banaadir)

Replacement for the old LRMIS of the Banadir Regional Administration. Somali first, English second.

**Status: Phase 1 (Foundation) delivered** — auth (staff email/password + Google + TOTP 2FA, citizen phone OTP),
Super Admin bootstrap, admin panel for users and roles (permission matrix), RLS on every table,
append-only audit log, i18n, app shell, design system, CI. See [CHANGELOG.md](CHANGELOG.md).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript strict · Supabase (Postgres + PostGIS, Auth, Storage, Realtime) ·
Tailwind CSS v4 · Radix/shadcn-style components · TanStack Table · React Hook Form + Zod · next-intl · Vitest · Playwright · PGlite (DB tests).

## Folder tree

```
apps/web                      Next.js app
  app/[locale]/(public)/      landing, /design (component gallery)
  app/[locale]/(auth)/        login, citizen/login (OTP), forgot/reset/change-password, mfa, setup
  app/[locale]/(staff)/       dashboard, audit
  app/[locale]/(admin)/admin/ users, users/new, users/[id], roles, roles/new, roles/[id],
                              permissions, login-history, settings
  app/[locale]/(citizen)/     portal
  app/auth/                   callback (OAuth/PKCE), confirm (email token links)
  app/api/                    health, exports/users
  components/shell            sidebar, top bar, ⌘K, language/theme, notifications, user menu
  components/admin            user form, role form, permission matrix, badges
  lib/server                  action wrapper, auth guards, request context, logging, queries
  lib/supabase                server / browser / admin (service-role) clients
  messages/so.json, en.json   translations (identical key sets, enforced by a test)
  middleware.ts               locale + session gate (suspended, forced password, 2FA, idle timeout)
packages/core                 permission catalog, Zod schemas, error codes, password policy
packages/ui                   design tokens (tokens.css) + components
supabase/migrations           SQL migrations (RBAC, RLS, audit, admin RPCs)
supabase/tests                runs the real migrations in PGlite: RBAC, RLS, escalation, lockout …
scripts/create-super-admin.ts first-run bootstrap
docs/                         architecture, open questions, admin runbook
```

## Run locally

Requirements: Node 20+, pnpm (via `corepack`), Docker + [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
corepack enable
pnpm install
supabase start            # applies supabase/migrations + seed.sql
cp .env.example apps/web/.env.local   # fill keys from `supabase status`
pnpm create-super-admin   # uses SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
pnpm dev                  # http://localhost:3000 → /so
```

First sign-in as Super Admin: change the password, then scan the QR code with an authenticator app.
Alternative to the script: set `SETUP_TOKEN` and open `/so/setup` once (it locks itself afterwards).

Local phone OTP: numbers `+252610000001` / `+252610000002` accept code `123456` (see `supabase/config.toml`).

## Tests

```bash
pnpm test        # unit (core, i18n) + database tests (PGlite runs every migration)
pnpm typecheck
pnpm lint
pnpm test:e2e    # Playwright; admin golden path needs a fresh stack + E2E_SUPER_ADMIN_* env
```

## Hosted Supabase checklist

- Enable the **Custom Access Token hook** → `public.custom_access_token_hook`.
- Auth → MFA: TOTP enabled. Auth → Email: disable public sign-ups (staff are created by admins). Phone provider: your SMS gateway.
- Email templates (invite, recovery): link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/so/reset-password`
  (use `type=recovery` for the recovery template).
- Google provider (optional): set client id/secret and `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only (Vercel env, never `NEXT_PUBLIC_`).

More: [docs/architecture.md](docs/architecture.md) · [docs/open-questions.md](docs/open-questions.md) · [docs/admin-runbook.md](docs/admin-runbook.md)
