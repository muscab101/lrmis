import { BrandLockup } from "@dhulka/ui/brand";
import { ArrowUpRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { AuthVisual } from "@/components/auth/auth-visual";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";

export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const ta = await getTranslations("auth");
  return (
    <div className="min-h-dvh bg-background p-3 antialiased">
      <div className="grid min-h-[calc(100dvh-1.5rem)] gap-3 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Form */}
        <div className="flex flex-col rounded-md border bg-card">
          <header className="flex h-20 items-center justify-between px-6 sm:px-10 lg:px-14">
            <Link href="/">
              <BrandLockup name={t("appShortName")} sub={t("orgName")} />
            </Link>
            <div className="flex items-center gap-1">
              <LocaleSwitch />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex flex-1 items-start justify-center px-6 pt-6 pb-16 sm:px-10 lg:items-center lg:px-14 lg:pt-0 xl:px-20">
            <div className="w-full max-w-[460px]">{children}</div>
          </main>
          <footer className="flex flex-wrap justify-between gap-2 border-t px-6 py-4 text-xs text-muted-foreground sm:px-10 lg:px-14">
            <span>{t("orgName")}</span>
            <span>{ta("secureNote")}</span>
          </footer>
        </div>

        {/* Surveyed city */}
        <aside className="relative hidden min-h-[640px] overflow-hidden rounded-md bg-[#0b1a3a] text-white lg:flex">
          <AuthVisual />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#06122e]/65 via-transparent to-[#06122e]/60" />
          <div className="relative z-10 flex h-full w-full flex-col justify-between p-12 xl:p-14">
            <h2 className="max-w-[560px] pt-10 text-5xl leading-[0.98] font-medium tracking-[-0.05em] text-balance xl:text-[64px]">{ta("panelTitle")}</h2>
            <div className="space-y-5">
              <p className="max-w-md text-base text-white/80">{ta("panelBody")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/notices"
                  className="inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-white/30 px-5 text-base font-medium text-white/90 backdrop-blur-sm transition-colors hover:border-white/55 hover:text-white"
                >
                  {ta("panelCta")}
                  <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </div>
              <p className="text-[11px] text-white/55">
                {ta("panelCredit")}{" "}
                <a href="/login/city-LICENSE.txt" className="underline underline-offset-2 hover:text-white/80">
                  {ta("panelLicence")}
                </a>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
