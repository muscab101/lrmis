import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("forgotTitle")} description={t("forgotBody")}>
      <ForgotForm />
    </AuthCard>
  );
}
