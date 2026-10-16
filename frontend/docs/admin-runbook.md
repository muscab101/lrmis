# Admin runbook

## First deploy
1. Apply migrations (`supabase db push`), configure Auth (see README checklist).
2. `pnpm create-super-admin` with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` — or open `/so/setup` with `SETUP_TOKEN`.
3. Sign in, change password, enrol 2FA. Create a second Super Admin so you are never locked out.

## Common tasks
| Task | Where | Notes |
|---|---|---|
| Create staff account | Admin → Users → New user | Set a temporary password (shown once) or send an invite. |
| Lost phone / 2FA | User → Security → Reset 2FA | Needs `users.reset_2fa`. User enrols again at next sign-in. |
| Forgotten password | User → Security → Set password / Email reset link | Setting a password signs the user out everywhere. |
| Leaver | User → Security → Suspend | Blocks sign-in at once; history kept. Prefer this over delete. |
| Locked out (5 failures) | wait 15 min | Shown in Admin → Login history. |
| New role | Admin → Roles → New role or Copy role | You can only grant permissions you hold yourself. |
| Remove a role | Roles → ⋯ → Delete | If users still hold it, pick a role to move them to. System roles can only be reset. |

## Guarantees enforced by the database
- At least one active Super Admin always exists; nobody can suspend/delete/demote themselves.
- Nobody can grant permissions, data scope or districts they don't have.
- The Super Admin role cannot be edited or deleted.
- `audit_log` is append-only (update/delete/truncate raise an error).

## Incident: user reports an error
Ask for the **Ref** shown under the message. Search server logs for that request id; database changes made in
that request carry the same id in `audit_log.request_id`.
