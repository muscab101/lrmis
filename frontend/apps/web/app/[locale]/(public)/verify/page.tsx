import { BrandLockup } from "@dhulka/ui/brand";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { VerifyChecker } from "./verify-checker";
import { VerifyGuide } from "./verify-guide";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: t("title") };
}

export default async function VerifyFormPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ code?: string }> }) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  const tc = await getTranslations("common");
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-2xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <LocaleSwitch />
      </header>
      <main className="mx-auto max-w-2xl px-5 py-10">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("body")}</p>
        <VerifyChecker initialCode={(code ?? "").slice(0, 20)} />

        <VerifyGuide />
      </main>
    </div>
  );
}
