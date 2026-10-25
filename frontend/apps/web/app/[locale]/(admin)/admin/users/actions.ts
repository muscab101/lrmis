"use server";

import { isPasswordBreached } from "@dhulka/core/password";
import { createUserSchema, deleteUserSchema, setUserPasswordSchema, updateUserSchema, userIdSchema } from "@dhulka/core/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { AppFailure, defineAction, fail, unwrap, withIdempotency, type ActionContext } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { createAdminClient, createIsolatedClient } from "@/lib/supabase/admin";

type UserAction =
  | "suspend"
  | "reactivate"
  | "soft_delete"
  | "hard_delete"
  | "set_password"
  | "send_reset_link"
  | "reset_2fa"
  | "force_signout"
  | "resend_invite"
  | "change_email";

/** Permission + target checks in Postgres before touching the Auth Admin API. */
async function authorize(ctx: ActionContext, userId: string, action: UserAction) {
  unwrap(await ctx.supabase.rpc("admin_authorize_user_action", { p_user_id: userId, p_action: action }), "authorize");
}

/** Database side (flags, session revocation, audit, notification) after the Auth API succeeded. */
async function apply(ctx: ActionContext, userId: string, action: UserAction) {
  unwrap(await ctx.supabase.rpc("admin_apply_user_action", { p_user_id: userId, p_action: action }), "apply");
}

/** Sensitive actions require the admin to re-enter their own password. */
async function reauthenticate(ctx: ActionContext, password: string) {
  const email = ctx.user.email;
  if (!email) fail("REAUTH_FAILED");
  const probe = createIsolatedClient();
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (error) throw new AppFailure("REAUTH_FAILED", undefined, { password: ["validation.password_wrong"] });
  await probe.auth.signOut({ scope: "local" });
}

async function assertNotBreached(password: string, requestId: string) {
  const breached = await isPasswordBreached(password);
  if (breached === null) log("warn", "admin.breach_check_unavailable", { requestId });
  if (breached) throw new AppFailure("PASSWORD_BREACHED", undefined, { "credentials.password": ["validation.password_breached"] });
}

function inviteRedirect(locale: string) {
  return `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(`/${locale}/reset-password`)}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export const createUserAction = defineAction(
  "admin.users.create",
  createUserSchema.extend({ locale: z.enum(["so", "en"]) }),
  async (input, ctx) =>
    withIdempotency(ctx, input.idempotencyKey, "users.create", async () => {
      const allDistricts = input.districts.mode === "all";
      const districtIds = input.districts.mode === "selected" ? input.districts.districtIds : [];

      // 1. Permission, escalation and district checks before anything is created.
      unwrap(
        await ctx.supabase.rpc("admin_validate_user_grants", {
          p_role_ids: input.roleIds,
          p_all_districts: allDistricts,
          p_district_ids: districtIds,
        }),
        "validate grants",
      );
      if (input.credentials.mode === "password") await assertNotBreached(input.credentials.password, ctx.requestId);

      // 2. Auth user (service role, server only).
      const admin = await createAdminClient();
      const created =
        input.credentials.mode === "password"
          ? await admin.auth.admin.createUser({
              email: input.email,
              password: input.credentials.password,
              email_confirm: true,
              app_metadata: { kind: "staff" },
              user_metadata: { full_name: input.fullName },
            })
          : await admin.auth.admin.inviteUserByEmail(input.email, {
              data: { full_name: input.fullName },
              redirectTo: inviteRedirect(input.locale),
            });
      if (created.error || !created.data.user) {
        if (created.error?.code === "email_exists" || created.error?.status === 422) fail("EMAIL_TAKEN");
        throw new Error(`createUser: ${created.error?.code} ${created.error?.message}`);
      }
      const userId = created.data.user.id;

      // 3. Profile, roles, districts in one transaction; roll the auth user back on failure.
      try {
        if (input.credentials.mode === "invite") {
          await admin.auth.admin.updateUserById(userId, { app_metadata: { kind: "staff" } });
        }
        unwrap(
          await ctx.supabase.rpc("admin_provision_user", {
            p_user_id: userId,
            p_full_name: input.fullName,
            p_phone: input.phone ?? "",
            p_role_ids: input.roleIds,
            p_all_districts: allDistricts,
            p_district_ids: districtIds,
            p_invited: input.credentials.mode === "invite",
          }),
          "provision",
        );
      } catch (err) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) log("error", "admin.users.rollback_failed", { requestId: ctx.requestId, userId, message: error.message });
        throw err;
      }
      revalidatePath("/[locale]/admin/users", "page");
      return { userId };
    }),
);

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------
export const updateUserAction = defineAction("admin.users.update", updateUserSchema, async (input, ctx) => {
  unwrap(
    await ctx.supabase.rpc("admin_update_user", {
      p_user_id: input.userId,
      p_full_name: input.fullName,
      p_phone: input.phone ?? "",
      p_role_ids: input.roleIds,
      p_all_districts: input.districts.mode === "all",
      p_district_ids: input.districts.mode === "selected" ? input.districts.districtIds : [],
    }),
    "update user",
  );
  revalidatePath(`/[locale]/admin/users/${input.userId}`, "page");
  return null;
});

// ---------------------------------------------------------------------------
// Status & security
// ---------------------------------------------------------------------------
export const userStatusAction = defineAction(
  "admin.users.status",
  userIdSchema.extend({ action: z.enum(["suspend", "reactivate", "force_signout", "reset_2fa", "send_reset_link", "resend_invite"]) }),
  async ({ userId, action }, ctx) => {
    await authorize(ctx, userId, action);
    const admin = await createAdminClient();
    switch (action) {
      case "suspend": {
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
        if (error) throw new Error(`ban: ${error.message}`);
        break;
      }
      case "reactivate": {
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
        if (error) throw new Error(`unban: ${error.message}`);
        break;
      }
      case "reset_2fa": {
        const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
        if (error) throw new Error(`listFactors: ${error.message}`);
        for (const factor of data.factors) {
          const res = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
          if (res.error) throw new Error(`deleteFactor: ${res.error.message}`);
        }
        break;
      }
      case "send_reset_link":
      case "resend_invite": {
        const { data } = await admin.auth.admin.getUserById(userId);
        const email = data.user?.email;
        if (!email) fail("NOT_FOUND");
        // Link opens in the user's own language.
        const { data: target } = await ctx.supabase.from("profiles").select("locale").eq("user_id", userId).single();
        const locale = (target?.locale as string | undefined) ?? "so";
        const res =
          action === "send_reset_link"
            ? await createIsolatedClient().auth.resetPasswordForEmail(email, { redirectTo: inviteRedirect(locale) })
            : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: inviteRedirect(locale) });
        if (res.error) throw new Error(`${action}: ${res.error.message}`);
        break;
      }
      case "force_signout":
        break; // sessions are revoked in the database step
    }
    await apply(ctx, userId, action);
    revalidatePath(`/[locale]/admin/users/${userId}`, "page");
    return null;
  },
);

export const setUserPasswordAction = defineAction("admin.users.set_password", setUserPasswordSchema, async (input, ctx) => {
  if (input.mode === "link") {
    const res = await userStatusAction({ userId: input.userId, action: "send_reset_link" });
    if (!res.ok) throw new AppFailure(res.error.code, res.error.values);
    return null;
  }
  await authorize(ctx, input.userId, "set_password");
  await assertNotBreached(input.password, ctx.requestId);
  const admin = await createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.userId, { password: input.password });
  if (error) {
    if (error.code === "weak_password") fail("PASSWORD_WEAK");
    throw new Error(`set password: ${error.message}`);
  }
  await apply(ctx, input.userId, "set_password");
  return null;
});

/** Change a staff member's sign-in email. The admin re-enters their own password; the user is signed out. */
export const changeUserEmailAction = defineAction(
  "admin.users.change_email",
  z.object({
    userId: z.uuid(),
    email: z.string().trim().toLowerCase().email("validation.email").max(254),
    password: z.string().min(1, "validation.password_wrong"),
  }),
  async (input, ctx) => {
    await reauthenticate(ctx, input.password);
    await authorize(ctx, input.userId, "change_email");
    const admin = await createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(input.userId, { email: input.email, email_confirm: true });
    if (error) {
      if (error.code === "email_exists" || /already/i.test(error.message)) {
        throw new AppFailure("VALIDATION", undefined, { email: ["validation.email_taken"] });
      }
      throw new Error(`change email: ${error.message}`);
    }
    unwrap(await ctx.supabase.rpc("admin_set_user_email", { p_user_id: input.userId, p_email: input.email }), "set email");
    revalidatePath("/[locale]/admin/users", "page");
    revalidatePath(`/[locale]/admin/users/${input.userId}`, "page");
    return null;
  },
);

// ---------------------------------------------------------------------------
// Delete (soft by default; hard only for Super Admin and only without records)
// ---------------------------------------------------------------------------
export const deleteUserAction = defineAction("admin.users.delete", deleteUserSchema, async (input, ctx) => {
  await reauthenticate(ctx, input.password);
  const action: UserAction = input.hard ? "hard_delete" : "soft_delete";
  await authorize(ctx, input.userId, action);
  const admin = await createAdminClient();

  if (input.hard) {
    await apply(ctx, input.userId, "hard_delete"); // audit row first; history survives the user
    const { error } = await admin.auth.admin.deleteUser(input.userId);
    if (error) throw new Error(`hard delete: ${error.message}`);
  } else {
    const { error } = await admin.auth.admin.updateUserById(input.userId, { ban_duration: "876000h" });
    if (error) throw new Error(`ban: ${error.message}`);
    await apply(ctx, input.userId, "soft_delete");
  }
  revalidatePath("/[locale]/admin/users", "page");
  return null;
});

/** Async search for the district picker (never ship the full list to the browser). */
export const searchDistrictsAction = defineAction(
  "admin.districts.search",
  z.object({ q: z.string().max(60) }),
  async ({ q }, ctx) => {
    let req = ctx.supabase.from("districts").select("id, code, name_so, name_en").is("deleted_at", null).order("name_so").limit(20);
    const term = q.replace(/[,()*%\\]/g, " ").trim();
    if (term) req = req.or(`name_so.ilike.%${term}%,name_en.ilike.%${term}%,code.ilike.%${term}%`);
    return unwrap(await req, "districts") as { id: string; code: string; name_so: string; name_en: string }[];
  },
);

/** Give a staff member their own cash desk (must be in one of their districts); null clears it. */
export const setUserPosAction = defineAction(
  "admin.users.set_pos",
  z.object({ userId: z.uuid(), posId: z.uuid().nullable() }),
  async ({ userId, posId }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("admin_set_user_pos", { p_user_id: userId, p_pos: posId }), "set point of sale");
    } catch (err) {
      if (err instanceof AppFailure && err.values?.detail === "pos_not_in_user_districts") {
        throw new AppFailure("VALIDATION", undefined, { posId: ["validation.pos_not_in_user_districts"] });
      }
      throw err;
    }
    revalidatePath(`/[locale]/admin/users/${userId}`, "page");
    revalidatePath("/[locale]/points-of-sale", "page");
    return null;
  },
);
