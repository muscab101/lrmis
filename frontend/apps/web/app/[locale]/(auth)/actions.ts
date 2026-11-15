"use server";

import { isPasswordBreached, LOCKOUT_MINUTES } from "@dhulka/core/password";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  localeSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  resetPasswordSchema,
  setupSchema,
  totpCodeSchema,
} from "@dhulka/core/schemas";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { publicEnv, serverEnv } from "@/lib/env";
import { AppFailure, defineAction, fail, unwrap, type ActionContext } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { requestContext } from "@/lib/server/request";
import { createAdminClient, createIsolatedClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkCode, citizenLoginToken, issueCode, phoneOnRegister } from "@/lib/server/citizen-otp";

async function recordLogin(
  email: string | null,
  userId: string | null,
  method: "password" | "google" | "otp" | "mfa",
  success: boolean,
  reason: string | null,
) {
  const ctx = await requestContext();
  const admin = await createAdminClient();
  const { error } = await admin.rpc("auth_record_login", {
    p_email: email ?? "",
    p_user_id: userId,
    p_method: method,
    p_success: success,
    p_reason: reason,
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
  });
  if (error) log("error", "auth.record_login_failed", { requestId: ctx.requestId, message: error.message });
}

/** Breach check that fails open (logged) when the range API is unreachable. */
async function assertNotBreached(password: string, requestId: string) {
  const breached = await isPasswordBreached(password);
  if (breached === null) log("warn", "auth.breach_check_unavailable", { requestId });
  if (breached) throw new AppFailure("PASSWORD_BREACHED", undefined, { password: ["validation.password_breached"] });
}

// ---------------------------------------------------------------------------
// Staff: email + password
// ---------------------------------------------------------------------------
export const loginAction = defineAction(
  "auth.login",
  loginSchema,
  async (input, ctx) => {
    const admin = await createAdminClient();
    const pre = unwrap(await admin.rpc("auth_login_precheck", { p_email: input.email }), "precheck") as {
      locked: boolean;
      locked_until?: string;
      remaining?: number;
    };
    if (pre.locked) {
      const minutes = Math.max(1, Math.ceil((new Date(pre.locked_until ?? 0).getTime() - Date.now()) / 60_000));
      await recordLogin(input.email, null, "password", false, "locked");
      fail("ACCOUNT_LOCKED", { minutes: Math.min(minutes, LOCKOUT_MINUTES) });
    }

    const { data, error } = await ctx.supabase.auth.signInWithPassword(input);
    if (error || !data.user) {
      const banned = error?.code === "user_banned";
      await recordLogin(input.email, null, "password", false, error?.code ?? "unknown");
      if (banned) fail("ACCOUNT_SUSPENDED");
      fail("INVALID_CREDENTIALS", { remaining: Math.max(0, (pre.remaining ?? 1) - 1) });
    }

    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("kind, status, deleted_at")
      .eq("user_id", data.user.id)
      .single();
    if (!profile || profile.deleted_at || profile.status === "suspended" || profile.status === "deleted") {
      await ctx.supabase.auth.signOut();
      await recordLogin(input.email, data.user.id, "password", false, "suspended");
      fail("ACCOUNT_SUSPENDED");
    }
    await recordLogin(input.email, data.user.id, "password", true, null);
    return { kind: profile.kind as "staff" | "citizen" };
  },
  { public: true },
);

export const googleSignInAction = defineAction(
  "auth.google",
  z.object({ locale: localeSchema, next: z.string().startsWith("/").default("/dashboard") }),
  async (input, ctx) => {
    const env = publicEnv();
    if (!env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED) fail("PERMISSION_DENIED");
    const redirectTo = `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?flow=google&next=${encodeURIComponent(`/${input.locale}${input.next}`)}`;
    const { data, error } = await ctx.supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) throw new Error(`google oauth: ${error?.message}`);
    return { url: data.url };
  },
  { public: true },
);

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Clear the inactivity timer so the next sign-in starts fresh.
  (await cookies()).delete("dhulka_last_seen");
}

export const forgotPasswordAction = defineAction(
  "auth.forgot",
  forgotPasswordSchema.extend({ locale: localeSchema }),
  async (input, ctx) => {
    const env = publicEnv();
    // Always "succeeds" so the form never reveals whether an email has an account.
    const { error } = await ctx.supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(`/${input.locale}/reset-password`)}`,
    });
    if (error) log("warn", "auth.reset_email_failed", { requestId: ctx.requestId, code: error.code });
    return null;
  },
  { public: true },
);

async function finishPasswordChange(ctx: ActionContext, password: string) {
  const { error } = await ctx.supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "insufficient_aal") fail("MFA_REQUIRED");
    if (error.code === "weak_password") fail("PASSWORD_WEAK");
    if (error.code === "same_password") throw new AppFailure("VALIDATION", undefined, { password: ["validation.password_same"] });
    throw new Error(`updateUser: ${error.code} ${error.message}`);
  }
  unwrap(await ctx.supabase.rpc("complete_password_change"), "complete_password_change");
}

/** Signed-in user changes their password (forced on first login, or from the user menu). */
export const changePasswordAction = defineAction("auth.change_password", changePasswordSchema, async (input, ctx) => {
  const email = ctx.user.email;
  if (!email) fail("VALIDATION");
  // Re-check the current password with an isolated client so the cookie session is untouched.
  const probe = createIsolatedClient();
  const { error } = await probe.auth.signInWithPassword({ email, password: input.current });
  if (error) throw new AppFailure("REAUTH_FAILED", undefined, { current: ["validation.password_wrong"] });
  await probe.auth.signOut({ scope: "local" });

  await assertNotBreached(input.password, ctx.requestId);
  await finishPasswordChange(ctx, input.password);
  return null;
});

/** From an emailed recovery or invite link (the session was created by that link). */
export const resetPasswordAction = defineAction("auth.reset_password", resetPasswordSchema, async (input, ctx) => {
  const {
    data: { session },
  } = await ctx.supabase.auth.getSession();
  const payload = session?.access_token.split(".")[1];
  const amr = payload
    ? ((JSON.parse(Buffer.from(payload, "base64url").toString()) as { amr?: { method: string }[] }).amr ?? [])
    : [];
  if (!amr.some((m) => ["recovery", "invite", "otp", "magiclink", "email/signup"].includes(m.method))) {
    fail("REAUTH_REQUIRED");
  }
  await assertNotBreached(input.password, ctx.requestId);
  await finishPasswordChange(ctx, input.password);
  return null;
});

// ---------------------------------------------------------------------------
// Staff: TOTP 2FA
// ---------------------------------------------------------------------------
export const mfaStartAction = defineAction("auth.mfa_start", z.object({}), async (_input, ctx) => {
  const { data: factors, error: listError } = await ctx.supabase.auth.mfa.listFactors();
  if (listError) throw new Error(`listFactors: ${listError.message}`);
  const verified = factors.totp.find((f) => f.status === "verified");
  if (verified) return { mode: "verify" as const, factorId: verified.id };

  // Drop half-finished enrolments so a retry starts clean.
  for (const f of factors.all.filter((x) => x.status === "unverified")) {
    await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await ctx.supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `LRMIS ${new Date().toISOString().slice(0, 10)}`,
    issuer: "LRMIS Banaadir",
  });
  if (error) throw new Error(`mfa enroll: ${error.message}`);
  return { mode: "enroll" as const, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
});

export const mfaVerifyAction = defineAction("auth.mfa_verify", totpCodeSchema, async (input, ctx) => {
  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.code });
  if (error) {
    await recordLogin(ctx.user.email ?? null, ctx.user.id, "mfa", false, error.code ?? "invalid");
    throw new AppFailure("VALIDATION", undefined, { code: ["validation.otp_wrong"] });
  }
  await recordLogin(ctx.user.email ?? null, ctx.user.id, "mfa", true, null);
  return null;
});

// ---------------------------------------------------------------------------
// Citizens: phone OTP
// ---------------------------------------------------------------------------
export const otpRequestAction = defineAction(
  "auth.otp_request",
  otpRequestSchema.extend({ locale: z.enum(["so", "en"]).default("so") }),
  async (input) => {
    // Only people on the land register: anyone else is asked to register at an LRMIS office first (no code is sent).
    if (!(await phoneOnRegister(input.phone))) throw new AppFailure("VALIDATION", undefined, { phone: ["validation.phone_not_registered"] });
    const ctx = await requestContext();
    const res = await issueCode(input.phone, ctx.ip, input.locale);
    if (!res.ok) {
      if (res.reason === "rate_limited") fail("RATE_LIMITED");
      log("error", "otp.send_failed", { reason: res.reason });
      fail("UNKNOWN", { detail: "sms_unavailable" });
    }
    return { devCode: res.devCode ?? null };
  },
  { public: true },
);

export const otpVerifyAction = defineAction(
  "auth.otp_verify",
  otpVerifySchema,
  async (input, ctx) => {
    if (!(await checkCode(input.phone, input.token))) {
      await recordLogin(input.phone, null, "otp", false, "invalid");
      throw new AppFailure("VALIDATION", undefined, { token: ["validation.otp_wrong"] });
    }
    if (!(await phoneOnRegister(input.phone))) throw new AppFailure("VALIDATION", undefined, { token: ["validation.phone_not_registered"] });
    const login = await citizenLoginToken(input.phone);
    if ("error" in login) {
      await recordLogin(input.phone, null, "otp", false, login.error);
      if (login.error === "staff_account") throw new AppFailure("VALIDATION", undefined, { token: ["validation.staff_use_email"] });
      fail("UNKNOWN", { detail: "signin_unavailable" });
    }
    const { data, error } = await ctx.supabase.auth.verifyOtp({ token_hash: login.tokenHash, type: "magiclink" });
    if (error || !data.user) {
      await recordLogin(input.phone, null, "otp", false, error?.code ?? "session");
      fail("UNKNOWN", { detail: "signin_unavailable" });
    }
    // Link to the owner record already on the register, if there is one.
    await ctx.supabase.rpc("my_party");
    await recordLogin(input.phone, data.user.id, "otp", true, null);
    return null;
  },
  { public: true },
);

// ---------------------------------------------------------------------------
// First run: create the Super Admin, then /setup locks itself.
// ---------------------------------------------------------------------------
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const setupAction = defineAction(
  "setup.super_admin",
  setupSchema,
  async (input, ctx) => {
    const { SETUP_TOKEN } = serverEnv();
    if (!SETUP_TOKEN || !tokenMatches(input.setupToken, SETUP_TOKEN)) {
      throw new AppFailure("PERMISSION_DENIED", undefined, { setupToken: ["validation.setup_token"] });
    }
    const admin = await createAdminClient();
    const status = unwrap(await admin.rpc("setup_status"), "setup_status") as { complete: boolean };
    if (status.complete) fail("SETUP_ALREADY_DONE");
    await assertNotBreached(input.password, ctx.requestId);

    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { kind: "staff" },
      user_metadata: { full_name: input.fullName },
    });
    if (error || !data.user) {
      if (error?.code === "email_exists") fail("EMAIL_TAKEN");
      throw new Error(`setup createUser: ${error?.message}`);
    }
    const boot = await admin.rpc("setup_bootstrap_super_admin", {
      p_user_id: data.user.id,
      p_full_name: input.fullName,
      p_must_change_password: false,
    });
    if (boot.error) {
      await admin.auth.admin.deleteUser(data.user.id);
      unwrap(boot, "setup_bootstrap_super_admin");
    }
    log("info", "setup.completed", { requestId: ctx.requestId, userId: data.user.id });
    return null;
  },
  { public: true },
);
