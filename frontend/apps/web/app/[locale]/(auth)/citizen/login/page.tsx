import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "../../auth-card";
import { OtpForm } from "./otp-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("citizenLoginTitle") };
}

export default async function CitizenLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("citizenLoginTitle")} description={t("citizenLoginBody")}>
      <OtpForm />
    </AuthCard>
  );
}
