import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getViewer } from "@/lib/server/auth";
import { AuthCard } from "../auth-card";
import { ChangePasswordForm } from "./change-password-form";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await getViewer();
  if (!viewer) return redirect({ href: "/login", locale });
  // Citizens sign in with an SMS code: they have no password to change.
  if (viewer.profile.kind === "citizen") return redirect({ href: "/portal", locale });
  const t = await getTranslations("auth");
  const forced = viewer.profile.must_change_password;
  return (
    <AuthCard title={t(forced ? "mustChangeTitle" : "changePasswordTitle")} description={t(forced ? "mustChangeBody" : "changePasswordBody")}>
      <ChangePasswordForm forced={forced} />
    </AuthCard>
  );
}
