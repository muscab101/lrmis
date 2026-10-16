import { BrandLockup } from "@dhulka/ui/brand";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";
import { TrackForm } from "./track-form";

export async function generateMetadata() {
  const t = await getTranslations("track");
  return { title: t("title") };
}

export default async function TrackPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ n?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("track");
  const tc = await getTranslations("common");
  const { n } = await searchParams;
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-3xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <p className="label-caps text-flag">{t("eyebrow")}</p>
        <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("body")}</p>
        <div className="mt-8">
          <TrackForm initialNumber={n ?? ""} />
        </div>
      </main>
    </div>
  );
}
