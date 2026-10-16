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

17. **Fee waiver** is the only way past "Awaiting payment" until Phase 7; it needs a Finance Manager (payments.approve), a reason, and someone other than the application's creator.
18. **Public notice** closes automatically after `registration.public_notice_days` (14) via a daily pg_cron job; the registrar's action also closes any notice that is due.
19. **Objections** are filed by signed-in users (citizens via phone OTP, or staff recording one received in person); anonymous objections are not accepted.
20. **Snapping** in the survey workspace is to corners of parcels visible on screen; the server still rejects overlaps above `survey.overlap_tolerance_m2`.

21. **Tax amounts** (grade amounts, default land rate 0.25 USD/m², service charges) are placeholders until the administration confirms its schedule (open question 1); all are editable on `/valuation`.
22. **Exemptions** reduce land + building tax by the approved percentage but not the service charge.
23. **Appeals** can only lower an assessment; an upheld appeal issues a new assessment that records the decision note.

24. **Penalty and discount** defaults (5 % once after 30 days' grace; 5 % for paying in full within 30 days of issue) are settings until finance confirms them.
25. **Billing period** is the year for property tax; quarterly/monthly periods are accepted by the schema for future fee types.
26. **Payment plans** are monthly; the last instalment absorbs rounding. Instalment tracking against payments arrives with Phase 7.

27. **WaafiPay**: integrated through API_PURCHASE (synchronous push to the payer's phone). The signature scheme for merchant-number/USSD notifications is assumed to be HMAC-SHA256 of the body in `x-waafi-signature`; confirm with WaafiPay when the merchant account is opened.
28. **Webhooks** run as a Next.js route handler (`/api/payments/webhook/<provider>`) rather than a Supabase Edge Function; the database function is the same either way.
29. **Exchange rates** are entered by accounting (SOS per USD, per day); the ledger is kept in USD.
30. **Refunds** are full reversals with second-person approval; partial refunds of overpayments use the customer credit instead.

31. **Owner photos** aren't captured yet (parties have `photo_path` but no upload); certificates and cards show the holder's initials until the photo step is added.
32. **E-signature** is the registrar's name plus the document's verification code; a cryptographic signature (PKI) can replace it once the administration has a signing key.

## Phase 9 assumptions

33. **Stamp duty** defaults to 2 % of the declared value (minimum from `transfers.stamp_duty_min`); inheritance pays the fixed `transfers.inheritance_duty`. Rates are settings until the finance office confirms them.
34. **Subdivision tolerance** is 1 % of the parent's area (`changes.subdivision_tolerance_pct`); children inherit the parent's owners and shares, and the parent is archived, not deleted.
35. **Leases** are only for public land, one active lease per parcel; rent isn't invoiced automatically yet.
36. **Permit fee** is a flat `building_permit` fee type (USD 50) until a schedule by floor area is agreed.

## Phase 10 assumptions

37. **SMS provider**: Twilio is wired as the default because its API is public and it reaches Somali numbers. A local gateway (Hormuud, Somtel) can be added as another provider once a contract and API docs exist (open question 4).
38. **Assistant data**: questions and aggregated report figures (including cashier names in the cashiers report) are sent to Anthropic's API. Leave `ANTHROPIC_API_KEY` empty if the administration doesn't approve sending data abroad.
39. **Campaign approval** is given to the Admin role (`messages.approve`). Customer Service creates campaigns but can't approve them.
40. **Scheduler**: the dispatcher needs an external cron hitting `/api/messages/dispatch` every minute (Vercel Cron or similar). pg_cron only requeues stuck messages.

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
