import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { smsProvider } from "@/lib/server/messaging";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Citizen sign-in by SMS code, run by LRMIS instead of the Supabase phone provider.
 * The code goes straight to the SMS provider (never into the outbox), only its HMAC is stored,
 * and a successful check signs the person in through a one-time magic-link token that is
 * verified on the server (no email is ever sent; citizens get an internal placeholder address).
 */
const PLACEHOLDER_DOMAIN = "phone.lrmis.invalid";

function pepper() {
  const p = process.env.OTP_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!p) throw new Error("OTP_PEPPER / SUPABASE_SERVICE_ROLE_KEY missing");
  return p;
}

const hash = (phone: string, code: string) => createHmac("sha256", pepper()).update(`${phone}:${code}`).digest("hex");
export const placeholderEmail = (phone: string) => `${phone.replace(/\D/g, "")}@${PLACEHOLDER_DOMAIN}`;

/** Development without an SMS provider: the code is shown on screen instead of being sent. */
export const showCodeOnScreen = () => process.env.NODE_ENV !== "production" && (process.env.SMS_PROVIDER ?? "log") === "log";

export type IssueResult = { ok: true; devCode?: string } | { ok: false; reason: "rate_limited" | "send_failed" | "not_configured" };

export async function issueCode(phone: string, ip: string | null, lang: "so" | "en"): Promise<IssueResult> {
  const provider = smsProvider();
  if (!provider) return { ok: false, reason: "not_configured" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const admin = await createAdminClient();
  const { data: stored, error } = await admin.rpc("citizen_otp_store", { p_phone: phone, p_hash: hash(phone, code), p_ip: ip });
  if (error) throw new Error(`otp store: ${error.message}`);
  if (!stored) return { ok: false, reason: "rate_limited" };
  if (showCodeOnScreen()) return { ok: true, devCode: code };
  const body = lang === "en" ? `LRMIS: your sign-in code is ${code}. It expires in 5 minutes. Never share it.` : `LRMIS: koodkaaga gelitaanka waa ${code}. Wuxuu dhacayaa 5 daqiiqo. Cidna ha la wadaagin.`;
  const sent = await provider.send({ id: `otp-${Date.now()}`, channel: "sms", to_address: phone, body, template_code: "otp" }).catch(() => ({ ok: false }));
  return sent.ok ? { ok: true } : { ok: false, reason: "send_failed" };
}

/** The phone belongs to someone on the land register: only they can use the citizen portal. */
export async function phoneOnRegister(phone: string) {
  const admin = await createAdminClient();
  const { data, error } = await admin.rpc("citizen_phone_registered", { p_phone: phone });
  if (error) throw new Error(`register check: ${error.message}`);
  return data === true;
}

export async function checkCode(phone: string, code: string) {
  const admin = await createAdminClient();
  const { data } = await admin.rpc("citizen_otp_consume", { p_phone: phone, p_hash: hash(phone, code) });
  return data === true;
}

/**
 * Finds or creates the citizen account for a verified phone and returns a one-time token hash
 * for `auth.verifyOtp({ type: "magiclink" })`. Staff accounts can't sign in this way.
 */
export async function citizenLoginToken(phone: string): Promise<{ tokenHash: string } | { error: "staff_account" | "failed" }> {
  const admin = await createAdminClient();
  const email = placeholderEmail(phone);
  // A phone can be on more than one account (e.g. a staff member who also owns land): sign in to the citizen one.
  // Only when the phone belongs to staff alone is it refused (staff sign in with email).
  const { data: rows } = await admin.from("profiles").select("user_id, kind, email").eq("phone", phone);
  const profile = (rows ?? []).find((r) => r.kind === "citizen");
  if (!profile && (rows ?? []).some((r) => r.kind === "staff")) return { error: "staff_account" };
  let userId = profile?.user_id as string | undefined;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true, email, email_confirm: true, user_metadata: { full_name: "" } });
    if (error || !data.user) return { error: "failed" };
    userId = data.user.id;
  } else if (!profile?.email) {
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) return { error: "failed" };
  }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: profile?.email && !profile.email.endsWith(PLACEHOLDER_DOMAIN) ? profile.email : email });
  if (error || !link.properties?.hashed_token) return { error: "failed" };
  return { tokenHash: link.properties.hashed_token };
}
