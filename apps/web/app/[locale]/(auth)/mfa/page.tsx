import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getViewer } from "@/lib/server/auth";
import { AuthCard } from "../auth-card";
import { MfaFlow } from "./mfa-flow";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

export default async function MfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await getViewer())) return redirect({ href: "/login", locale });
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("mfaTitle")} description={t("mfaBody")}>
      <MfaFlow />
    </AuthCard>
  );
}
