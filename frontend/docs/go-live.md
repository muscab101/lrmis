# Go-live plan

## 1. Readiness (two weeks before)
- [ ] Domain decided; `NEXT_PUBLIC_SITE_URL` and the `site.public_url` setting updated.
- [ ] Base maps: `NEXT_PUBLIC_MAPTILER_KEY` set in Vercel (without it the map falls back to the free OSM/Esri tiles, which aren't licensed for production); in the MapTiler dashboard the key is restricted to the production domain.
- [ ] Production Supabase project on a paid plan with daily backups and point-in-time recovery; all migrations applied (`pnpm db:push`).
- [ ] Every item under "Before go-live" in `docs/security-review.md` done.
- [ ] Payment providers: WaafiPay merchant live keys, webhook URL `https://<domain>/api/payments/webhook/waafipay`, test payment of USD 0.10 reconciled.
- [ ] SMS: `SMS_PROVIDER` set; a scheduler calls `POST /api/messages/dispatch` every minute with the bearer secret.
- [ ] USSD short code live and pointed at `https://<domain>/api/ussd?key=…` (IP-restricted at the gateway).
- [ ] WhatsApp number verified; webhook subscribed to `messages`.
- [ ] Load test passed on staging: `pnpm load-test` with `BASE_URL=https://staging…` (thresholds in `tests/load/public.js`).
- [ ] Real district codes and neighbourhood boundaries imported (`/locations`).
- [ ] Tax rates, fee types and grades confirmed by finance (`/valuation`).
- [ ] Staff accounts created with the right roles and districts; training done (`docs/training`).

## 2. Data migration
1. Export the legacy register to CSV in the format of `docs/samples/legacy-import.csv`, one file per district.
2. Dry run: `pnpm import-legacy hodan.csv --actor registrar@… --batch HDN-1`. Fix every `invalid` row at the source and repeat until clean.
3. Commit: add `--commit`. Keep the report CSV with the batch record.
4. Each imported record is a draft office application. Front desk completes documents and fees; it then follows the normal survey → notice → registration flow. Nothing is registered without a survey.

## 3. Cut-over (pilot district first)
- Day 0: Hodan only. Paper and system run in parallel for two weeks; every new case goes into the system.
- Daily: check `/admin/health`, the trial balance and the cashier close for each point of sale.
- After two clean weeks, add two districts per week. Paper intake stops in a district once its backlog is imported.

## 4. Rollback
The database is the record. If the app has to be withdrawn, payments and registrations already made stay valid. Restore service from the last deployment (Vercel → Instant Rollback). Restore the database only with finance's sign-off, and only to a point before the problem (PITR).
