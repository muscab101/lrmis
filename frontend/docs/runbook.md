# Runbook

| Symptom | Where to look | What to do |
| --- | --- | --- |
| Site down | `GET /api/health` (503 = database unreachable), Vercel status, Supabase status | Roll back the last deployment if it started after a release; otherwise wait for the provider and post a notice. |
| SMS not arriving | `/admin/health` → oldest waiting message; `/messages?f=failed` | Scheduler stopped → restart it. Provider errors → check credit and keys, then retry failed messages. |
| Payment taken but bill still open | `/payments?tab=unmatched`, the provider dashboard, `provider_webhook_events` | Match the payment to the parcel; if the webhook never arrived, record it from the provider's statement through reconciliation. |
| Ledger "Problem" on health | `/accounting` trial balance | Freeze manual journals and call the accountant. Never edit `journal_lines` directly; post a correcting entry. |
| Webhook bad signatures | `/admin/health`, provider settings | One or two can be probes. Many means a wrong secret after rotation, or an attack: compare secrets and block at the edge. |
| Staff locked out | `/admin/users` → reset password / 2FA | If no admin can sign in: `pnpm reset-admin-password <email> [--reset-2fa]` on a trusted machine. |
| Suspected data leak | `/audit` (filter by user and time), `login_events` | Suspend the account (signs out every session), keep the audit export, escalate to the director. |

## Rotating a secret
1. Create the new value at the provider.
2. Update the environment variable and redeploy.
3. Revoke the old value.
4. Check `/admin/health` → Configuration, then do one real end-to-end action (e.g. a test SMS).

## Backups
Supabase daily backups plus point-in-time recovery. Once a month, restore a backup into a scratch project and run `pnpm test:db` against the restored schema. Record the date in the operations log.
