import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createIntlMiddleware(routing);

/** Paths (after the locale) anyone can open. */
const PUBLIC = [/^\/$/, /^\/login$/, /^\/citizen\/login$/, /^\/forgot-password$/, /^\/setup$/, /^\/design$/, /^\/verify(\/|$)/, /^\/pay\//, /^\/track(\/|$)/, /^\/notices$/];
/** Steps of the sign-in flow: need a user but skip the staff gates. */
const AUTH_FLOW = [/^\/mfa$/, /^\/change-password$/, /^\/reset-password$/];
/** Citizen portal. Everything else is the staff area. */
const CITIZEN = [/^\/portal(\/|$)/];

const IDLE_COOKIE = "dhulka_last_seen";
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 30);

interface SessionState {
  kind: "staff" | "citizen";
  status: "active" | "invited" | "suspended" | "deleted";
  deleted: boolean;
  must_change_password: boolean;
  mfa_required: boolean;
  permissions_changed_at: number;
}

function jwtIat(token: string | undefined): number {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return 0;
    return (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { iat?: number }).iat ?? 0;
  } catch {
    return 0;
  }
}

export async function middleware(request: NextRequest) {
  const response = intl(request);
  // Locale redirect (e.g. /admin → /so/admin): let next-intl answer first.
  if (response.headers.get("location")) return response;

  const [, maybeLocale = "", ...rest] = request.nextUrl.pathname.split("/");
  const locale = (routing.locales as readonly string[]).includes(maybeLocale) ? maybeLocale : routing.defaultLocale;
  const path = `/${rest.join("/")}`.replace(/\/$/, "") || "/";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // not configured: pages show a clear setup error

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const redirectTo = (target: string, params?: Record<string, string>) => {
    const dest = new URL(`/${locale}${target}`, request.url);
    for (const [k, v] of Object.entries(params ?? {})) dest.searchParams.set(k, v);
    const res = NextResponse.redirect(dest);
    for (const c of response.cookies.getAll()) res.cookies.set(c);
    return res;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC.some((r) => r.test(path));
  const isAuthFlow = AUTH_FLOW.some((r) => r.test(path));
  const isCitizen = CITIZEN.some((r) => r.test(path));
  const isStaff = !isPublic && !isAuthFlow && !isCitizen;

  if (!user) {
    if (isPublic) return response;
    return redirectTo(isCitizen ? "/citizen/login" : "/login", { next: request.nextUrl.pathname });
  }
  if (isPublic) return response;

  const { data } = await supabase.rpc("my_session_state");
  const state = data as SessionState | null;
  if (!state || state.deleted || state.status === "suspended" || state.status === "deleted") {
    await supabase.auth.signOut();
    return redirectTo("/login", { error: "ACCOUNT_SUSPENDED" });
  }

  // Roles/districts changed since this token was issued → refresh so JWT claims are current.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (state.permissions_changed_at > jwtIat(session?.access_token)) {
    await supabase.auth.refreshSession();
  }

  if (isStaff || isAuthFlow) {
    if (state.kind !== "staff") return isStaff ? redirectTo("/portal") : response;

    // Idle timeout for staff sessions.
    const lastSeen = Number(request.cookies.get(IDLE_COOKIE)?.value ?? 0);
    if (lastSeen && Date.now() - lastSeen > IDLE_MINUTES * 60_000) {
      await supabase.auth.signOut();
      const res = redirectTo("/login", { error: "SESSION_EXPIRED", next: request.nextUrl.pathname });
      res.cookies.delete(IDLE_COOKIE);
      return res;
    }
    response.cookies.set(IDLE_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });

    const needsPassword = state.must_change_password || state.status === "invited";
    if (needsPassword) {
      return path === "/change-password" || path === "/reset-password" ? response : redirectTo("/change-password");
    }
    if (state.mfa_required) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== "aal2") return path === "/mfa" ? response : redirectTo("/mfa");
    }
    // Fully signed in: the 2FA step is done. (Changing the password voluntarily stays allowed.)
    if (path === "/mfa") return redirectTo("/dashboard");
  }

  return response;
}

export const config = {
  // Everything except API routes, auth callbacks, Next internals and static files.
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
