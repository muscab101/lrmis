import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function safeNext(next: string | null): string {
  return next && /^\/(so|en)\//.test(next) && !next.startsWith("//") ? next : "/so/dashboard";
}

/**
 * PKCE code exchange for Google sign-in and emailed recovery links.
 * Google never creates a staff account: if the Google email doesn't belong to an existing
 * staff user, the just-created auth user is removed and the person is sent back to login.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const locale = next.slice(1, 3);
  const loginUrl = (error: string) => new URL(`/${locale}/login?error=${error}`, url.origin);

  if (!code) return NextResponse.redirect(loginUrl("UNAUTHENTICATED"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    log("warn", "auth.callback_failed", { code: error?.code });
    return NextResponse.redirect(loginUrl("UNAUTHENTICATED"));
  }

  if (url.searchParams.get("flow") === "google") {
    const user = data.user;
    const { data: profile } = await supabase.from("profiles").select("kind, status, created_at").eq("user_id", user.id).single();
    const admin = await createAdminClient();
    if (!profile || profile.kind !== "staff" || profile.status !== "active") {
      await supabase.auth.signOut();
      // Remove an account that Google sign-in itself just created (nothing else references it).
      const createdJustNow = Date.now() - new Date(user.created_at).getTime() < 2 * 60_000;
      const onlyGoogle = (user.identities ?? []).every((i) => i.provider === "google");
      if (createdJustNow && onlyGoogle) await admin.auth.admin.deleteUser(user.id);
      await admin.rpc("auth_record_login", {
        p_email: user.email ?? "",
        p_user_id: null,
        p_method: "google",
        p_success: false,
        p_reason: "no_staff_account",
        p_ip: request.headers.get("x-forwarded-for"),
        p_user_agent: request.headers.get("user-agent"),
      });
      return NextResponse.redirect(loginUrl(profile?.status === "suspended" ? "ACCOUNT_SUSPENDED" : "GOOGLE_NO_STAFF_ACCOUNT"));
    }
    await admin.rpc("auth_record_login", {
      p_email: user.email ?? "",
      p_user_id: user.id,
      p_method: "google",
      p_success: true,
      p_reason: null,
      p_ip: request.headers.get("x-forwarded-for"),
      p_user_agent: request.headers.get("user-agent"),
    });
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
