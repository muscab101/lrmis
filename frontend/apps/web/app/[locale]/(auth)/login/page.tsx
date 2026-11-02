import { getTranslations, setRequestLocale } from "next-intl/server";
import { publicEnv } from "@/lib/env";
import { AuthCard } from "../auth-card";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("staffLoginTitle") };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next, error } = await searchParams;
  const t = await getTranslations("auth");
  const tr = await getTranslations("workRecording");
  let googleEnabled = false;
  try {
    googleEnabled = publicEnv().NEXT_PUBLIC_GOOGLE_AUTH_ENABLED;
  } catch {
    /* not configured */
  }
  // Only same-site relative paths are allowed as redirect targets.
  const safeNext = next && next.startsWith(`/${locale}/`) && !next.startsWith("//") ? next : undefined;
  return (
    <AuthCard title={t("staffLoginTitle")} description={t("staffLoginBody")}>
      <LoginForm next={safeNext} initialError={error ?? null} googleEnabled={googleEnabled} />
      <p className="mt-4 text-xs text-muted-foreground">{tr("signInNotice")}</p>
    </AuthCard>
  );
}
