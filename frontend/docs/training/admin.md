# Admin

**You do:** accounts, roles, settings, system health, message approval.

1. **Users** (`/admin/users`): create staff with roles and districts; suspend when someone leaves (this signs them out everywhere). Use a soft delete; hard delete is only for accounts with no records.
2. **Roles:** start from the built-in roles. A custom role can't give more than you have.
3. **Health** (`/admin/health`): check it every morning. Anything marked Check or Problem has a hint next to it; the runbook has the rest.
4. **SMS campaigns:** approve or reject campaigns created by customer service. Check the recipient count and the sample text.
5. **Break-glass:** if no admin can sign in, `pnpm reset-admin-password` on a trusted machine. Never send passwords by chat or SMS.

**Exercises:** create a cashier for one district, suspend and reactivate them, read the health page and explain each warning.
