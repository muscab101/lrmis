# Assumptions and open questions

Defaults used until the administration decides. Each is easy to change.

## Phase 1 assumptions

1. **Citizen portal URL** is `/portal/*` (the spec's `(citizen)/applications` would collide with staff `/applications`).
2. **Data scope `district` vs `districts`**: both mean "the districts assigned to the user"; `district` is the label for single-district staff. A user with `all_districts` sees every district if their role scope is district-based. `own` = only own records (enforced per table from Phase 3).
3. **2FA is required for all staff** (`security.staff_mfa_required = true`), enforced in the database (no permission works at aal1). Citizens use phone OTP only.
4. **Super Admin created via `/setup`** does not have to change the password it just chose; via the script it must (the env password is shared).
5. **Breach check** uses the Have I Been Pwned range API (k-anonymity). If it is unreachable the check is skipped and logged (fail open) so staff are not locked out by an outage.
6. **Session idle timeout**: 30 minutes for staff (`SESSION_IDLE_MINUTES`).
7. **District list in `seed.sql`** is for development; codes are placeholders. Official names/codes come from the legacy import (Phase 12).
8. **Somali translations** were written by the engineering team — they need review by a native speaker in the administration before go-live.
9. **Hard-deleting users** is allowed only for a Super Admin and only if the user has no rows in tables listed in `private.user_record_tables` (empty in Phase 1; parcels, invoices, payments … register in later phases).
10. **Settings page** is read-only in Phase 1; editing (with re-auth and approval) comes with the modules that use those settings.

## Phase 2–3 assumptions

11. **Neighbourhood codes** are unique within a district (they become part of the PUN); section and sector codes are unique within their parent.
12. **Test boundaries**: the dev seed has three approximate test squares in Hodan/Wadajir (`legacy_id = 'DEV-SEED'`). Real boundaries must be imported (GeoJSON per level) — see open question 6.
13. **Base maps**: without a MapTiler key the map uses OpenStreetMap tiles (fine for testing, not for production traffic) and Esri imagery. Production needs a MapTiler (or Mapbox) key.
14. **Citizen co-owners**: a citizen applying online is recorded as the 100% owner; co-owners/heirs are added by the office during verification.
15. **Application fee**: submitted applications wait at "Awaiting payment" until the payments module (Phase 7) creates the invoice; there is deliberately no manual "mark as paid".
16. **Owner phone verification**: only a citizen's own phone (verified by OTP at sign-in) is marked verified; front-desk SMS verification comes with the SMS provider (Phase 11).

## Open questions (from the brief, defaults unchanged)

1. Exact tax formula and rates per neighbourhood/use (default §4.6).
2. PUN format (default `BN-<district>-<neighbourhood>-<serial:6>`).
3. Payment providers and merchant accounts (default WaafiPay + cash + bank; Stripe only if eligible).
4. SMS / WhatsApp provider.
5. Certificate and ID card layout, signatures, security paper.
6. Existing GIS data (shapefiles, drone imagery)?
7. Who approves what (default §3).
8. Public notice period (default 14 days) and whether certificates require full payment (default yes).
9. **New:** official district codes (2–6 letters) for the PUN.
10. **New:** should Google sign-in be enabled at launch, and for which staff domains?
