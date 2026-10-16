/**
 * pnpm reset-admin-password <email> [--reset-2fa]
 *
 * Break-glass reset for a staff account when nobody else can sign in to do it from the
 * admin panel. Asks for the new password with hidden input (never put it on the command
 * line or in chat), applies the same policy as the app (length, leaked-password check) and
 * sets it through the Supabase Admin API with the service-role key in apps/web/.env.local.
 * --reset-2fa also removes the account's authenticator so it can be enrolled again.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
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

/** Reads a line without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  const reset2fa = args.includes("--reset-2fa");
  if (!email) {
    console.error("Usage: pnpm reset-admin-password <email> [--reset-2fa]");
    process.exit(1);
  }

  const admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const profile = await admin.from("profiles").select("user_id, kind, status").eq("email", email).is("deleted_at", null).maybeSingle();
  if (profile.error) throw new Error(`profile lookup: ${profile.error.message}`);
  if (!profile.data || profile.data.kind !== "staff") throw new Error(`No staff account for ${email}.`);
  const userId = profile.data.user_id as string;

  const password = await askHidden("New password (hidden): ");
  const confirm = await askHidden("Type it again: ");
  if (password !== confirm) throw new Error("The two passwords don't match.");
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`Password not accepted: ${problems.join(", ")} (use at least 10 characters).`);
  if (await isPasswordBreached(password)) throw new Error("That password appears in known data leaks. Choose a different one.");

  const updated = await admin.auth.admin.updateUserById(userId, { password });
  if (updated.error) throw new Error(`update password: ${updated.error.message}`);
  console.log(`✓ Password changed for ${email}.`);

  if (reset2fa) {
    const factors = await admin.auth.admin.mfa.listFactors({ userId });
    if (factors.error) throw new Error(`list 2FA factors: ${factors.error.message}`);
    for (const f of factors.data.factors) {
      const del = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
      if (del.error) throw new Error(`remove 2FA factor: ${del.error.message}`);
    }
    console.log(`✓ Two-factor removed (${factors.data.factors.length}). You'll set it up again at the next sign-in.`);
  }
  if (profile.data.status !== "active") console.log(`! The account status is "${profile.data.status}", so sign-in will still be refused.`);
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
