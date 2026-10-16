import { BrandLockup } from "@dhulka/ui/brand";
import { Button } from "@dhulka/ui/button";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelArt } from "@/components/brand/parcel-art";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";

const STEPS = ["apply", "survey", "register", "pay", "certificate"] as const;

export default async function Landing({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");

  const entries = [
    { title: t("citizenTitle"), body: t("citizenBody"), href: "/citizen/login", cta: t("citizenCta") },
    { title: t("staffTitle"), body: t("staffBody"), href: "/login", cta: t("staffCta") },
    { title: t("verifyTitle"), body: t("verifyBody"), href: null, cta: tc("comingInPhase", { n: 8 }) },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <section className="relative overflow-hidden bg-ink text-ink-foreground">
        <div className="bg-register-grid absolute inset-0" aria-hidden />
        <header className="relative mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} inverted />
          <div className="flex items-center gap-1 [&_button]:text-ink-foreground [&_button:hover]:bg-white/10">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
        </header>
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pt-10 pb-20 lg:grid-cols-[1.15fr_1fr] lg:pt-16 lg:pb-28">
          <div>
            <p className="label-caps text-flag">{t("eyebrow")}</p>
            <h1 className="mt-4 text-4xl leading-[1.08] font-semibold text-balance sm:text-[56px]">{t("headline")}</h1>
            <p className="mt-6 max-w-xl text-base text-ink-foreground/70 sm:text-lg">{t("lead")}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button size="lg" asChild className="bg-flag text-white hover:bg-flag/90">
                <Link href="/citizen/login">
                  {t("citizenCta")}
                  <ArrowRight className="rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-white/25 bg-transparent text-ink-foreground hover:border-white/50 hover:bg-white/5">
                <Link href="/login">{t("staffCta")}</Link>
              </Button>
            </div>
          </div>
          <ParcelArt pun="BN-HDN-012-000123" className="mx-auto h-auto w-full max-w-[440px] text-ink-foreground" />
        </div>
      </section>

      <section className="border-b bg-card">
        <ol className="mx-auto grid max-w-6xl sm:grid-cols-5">
          {STEPS.map((step, i) => (
            <li key={step} className="border-b px-5 py-7 sm:border-e sm:border-b-0 last:border-0">
              <div className="font-mono text-xs text-flag">0{i + 1}</div>
              <div className="mt-2 font-semibold">{t(`steps.${step}.title`)}</div>
              <p className="mt-1 text-[13px] text-muted-foreground">{t(`steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="label-caps text-muted-foreground">{t("entriesTitle")}</h2>
        <ul className="mt-4 divide-y border-y">
          {entries.map((e) => (
            <li key={e.title}>
              {e.href ? (
                <Link href={e.href} className="group grid gap-1 py-6 sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-8">
                  <span className="text-lg font-semibold">{e.title}</span>
                  <span className="text-sm text-muted-foreground">{e.body}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:underline">
                    {e.cta}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
                  </span>
                </Link>
              ) : (
                <div className="grid gap-1 py-6 sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-8">
                  <span className="text-lg font-semibold">{e.title}</span>
                  <span className="text-sm text-muted-foreground">{e.body}</span>
                  <span className="text-sm text-muted-foreground">{e.cta}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} {tc("orgName")}</span>
          <span>Muqdisho · Mogadishu</span>
        </div>
      </footer>
    </div>
  );
}
