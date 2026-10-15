import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change", "signup", "magiclink"];

/**
 * Email links with a token hash (invite, recovery). Configure the Supabase email templates
 * to link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/so/reset-password
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next");
  const next = nextParam && /^\/(so|en)\//.test(nextParam) ? nextParam : "/so/reset-password";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`/${next.slice(1, 3)}/login?error=REAUTH_REQUIRED`, url.origin));
}
