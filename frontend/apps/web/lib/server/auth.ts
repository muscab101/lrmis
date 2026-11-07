import "server-only";
import type { PermissionKey } from "@dhulka/core/permissions";
import { forbidden } from "next/navigation";
import { cache } from "react";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getImpersonation } from "./impersonation";

export interface Profile {
  user_id: string;
  kind: "staff" | "citizen";
  full_name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "invited" | "suspended" | "deleted";
  must_change_password: boolean;
  locale: "so" | "en";
  all_districts: boolean;
  /** The cashier's own cash desk (Admin → Users). */
  point_of_sale_id: string | null;
  /** Their own photo (private file; shown by a short-lived link). */
  avatar_path: string | null;
}

export interface Viewer {
  /** The signed-in account (from its checked sign-in token). */
  user: { id: string; email: string | null };
  profile: Profile;
  permissions: ReadonlySet<string>;
  aal: "aal1" | "aal2";
  mfaRequired: boolean;
  isSuperAdmin: boolean;
  /** A super admin is signed in as this user to test it. */
  testing: boolean;
  can: (perm: PermissionKey) => boolean;
}

/** The signed-in user with profile + effective permissions. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  // The sign-in token is checked here with the project's public key: no trip to the auth server on every page.
  // (The database still checks the account is active and not signed out everywhere on every query.)
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const user = { id: claims.sub, email: (claims.email as string | undefined) ?? null };

  const [profileRes, permsRes, aalRes, stateRes, superRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "user_id, kind, full_name, email, phone, status, must_change_password, locale, all_districts, point_of_sale_id, avatar_path",
      )
      .eq("user_id", user.id)
      .single(),
    supabase.rpc("my_permissions"),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc("my_session_state"),
    supabase
      .from("user_roles")
      .select("roles!inner(grants_all)")
      .eq("user_id", user.id)
      .eq("roles.grants_all", true),
  ]);
  if (!profileRes.data) return null;

  const permissions = new Set<string>((permsRes.data as string[] | null) ?? []);
  const state = stateRes.data as { mfa_required?: boolean } | null;
  return {
    user,
    profile: profileRes.data as Profile,
    permissions,
    aal: aalRes.data?.currentLevel === "aal2" ? "aal2" : "aal1",
    mfaRequired: Boolean(state?.mfa_required),
    isSuperAdmin: (superRes.data?.length ?? 0) > 0,
    testing: Boolean(await getImpersonation(user.id)),
    can: (perm) => permissions.has(perm),
  };
});

/** Page guard for staff areas. The middleware already redirects; this is the server-side check. */
export async function requireStaff(locale: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect({ href: "/login", locale });
  const v = viewer as Viewer;
  if (v.profile.kind !== "staff") redirect({ href: "/my-properties", locale });
  // A super admin testing this account doesn't set its password or do its 2FA.
  if (v.testing) return v;
  if (v.profile.must_change_password || v.profile.status === "invited")
    redirect({ href: "/change-password", locale });
  if (v.mfaRequired && v.aal !== "aal2") redirect({ href: "/mfa", locale });
  return v;
}

/** 403 when the permission is missing (renders app/[locale]/forbidden.tsx). */
export async function requirePermission(locale: string, perm: PermissionKey): Promise<Viewer> {
  const viewer = await requireStaff(locale);
  if (!viewer.can(perm)) forbidden();
  return viewer;
}

export async function requireCitizen(locale: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect({ href: "/citizen/login", locale });
  return viewer as Viewer;
}
