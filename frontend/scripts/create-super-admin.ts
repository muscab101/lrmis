/**
 * pnpm create-super-admin
 *
 * Creates the first Super Admin from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD (+ optional
 * SUPER_ADMIN_NAME) using the Supabase Admin API. Safe to re-run: it refuses once a Super
 * Admin exists. The account must change its password and enrol TOTP 2FA at first sign-in.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { isPasswordBreached, passwordProblems } from "../packages/core/src/password";

config({ path: "apps/web/.env.local" });
config({ path: ".env" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("SUPER_ADMIN_EMAIL").trim().toLowerCase();
  const password = required("SUPER_ADMIN_PASSWORD");
  const fullName = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";

  const problems = passwordProblems(password);
  if (problems.length) {
    console.error(`✗ SUPER_ADMIN_PASSWORD is too weak: ${problems.join(", ")} (min 10 chars, mixed characters).`);
    process.exit(1);
  }
  if (await isPasswordBreached(password)) {
    console.error("✗ SUPER_ADMIN_PASSWORD appears in a known data breach. Choose another.");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const status = await admin.rpc("setup_status");
  if (status.error) throw new Error(`setup_status: ${status.error.message} — are the migrations applied?`);
  if ((status.data as { complete: boolean }).complete) {
    console.log("✓ A Super Admin already exists. Nothing to do.");
    return;
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { kind: "staff" },
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser: ${created.error?.code} ${created.error?.message}`);
  }
  const userId = created.data.user.id;

  const boot = await admin.rpc("setup_bootstrap_super_admin", {
    p_user_id: userId,
    p_full_name: fullName,
    p_must_change_password: true,
  });
  if (boot.error) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`bootstrap: ${boot.error.message} (auth user rolled back)`);
  }

  console.log(`✓ Super Admin created: ${email}`);
  console.log("  First sign-in: change the password, then set up 2FA with an authenticator app.");
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
