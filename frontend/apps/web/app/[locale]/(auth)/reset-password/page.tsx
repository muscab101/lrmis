import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getViewer } from "@/lib/server/auth";
import { AuthCard } from "../auth-card";
import { ResetPasswordForm } from "./reset-password-form";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

/** Landing page of emailed recovery and invite links. */
export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await getViewer();
  if (!viewer) return redirect({ href: "/forgot-password", locale });
  const t = await getTranslations("auth");
  const invited = viewer.profile.status === "invited";
  return (
    <AuthCard title={t(invited ? "inviteTitle" : "resetTitle")} description={t(invited ? "inviteBody" : "resetBody")}>
      <ResetPasswordForm />
    </AuthCard>
  );
}
