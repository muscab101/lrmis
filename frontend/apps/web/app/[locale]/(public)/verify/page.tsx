import { BrandLockup } from "@dhulka/ui/brand";
import { Button } from "@dhulka/ui/button";
import { Input } from "@dhulka/ui/input";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { goToVerify } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: t("title") };
}

export default async function VerifyFormPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  const tc = await getTranslations("common");
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <LocaleSwitch />
      </header>
      <main className="mx-auto max-w-xl px-5 py-10">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("body")}</p>
        <form action={goToVerify.bind(null, locale)} className="mt-6 flex gap-2">
          <Input name="code" placeholder="ABCD-EFGH-JKMN" aria-label={t("code")} className="font-mono uppercase" autoComplete="off" />
          <Button type="submit">{t("check")}</Button>
        </form>
      </main>
    </div>
  );
}
