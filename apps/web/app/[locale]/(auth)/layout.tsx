import { BrandLockup } from "@dhulka/ui/brand";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ParcelArt } from "@/components/brand/parcel-art";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";

export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const ta = await getTranslations("auth");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Register panel */}
      <aside className="relative hidden overflow-hidden bg-ink text-ink-foreground lg:flex lg:flex-col">
        <div className="bg-register-grid absolute inset-0 text-ink-foreground" aria-hidden />
        <div className="relative flex h-20 items-center px-10">
          <Link href="/">
            <BrandLockup name={t("appShortName")} sub={t("orgName")} inverted />
          </Link>
        </div>
        <div className="relative flex flex-1 items-center justify-center px-10">
          <ParcelArt pun="BN-HDN-012-000123" className="h-auto w-full max-w-[420px] text-ink-foreground" />
        </div>
        <div className="relative space-y-2 px-10 pb-10">
          <p className="max-w-sm text-2xl leading-snug font-semibold">{ta("panelTitle")}</p>
          <p className="max-w-sm text-sm text-ink-foreground/60">{ta("panelBody")}</p>
        </div>
      </aside>

      {/* Form */}
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex h-20 items-center justify-between px-5 sm:px-10">
          <Link href="/" className="lg:invisible">
            <BrandLockup name={t("appShortName")} />
          </Link>
          <div className="flex items-center gap-1">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 pt-4 pb-16 sm:px-10 sm:pt-12 lg:items-center lg:pt-0">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        <footer className="flex flex-wrap justify-between gap-2 border-t px-5 py-4 text-xs text-muted-foreground sm:px-10">
          <span>{t("orgName")}</span>
          <span>{ta("secureNote")}</span>
        </footer>
      </div>
    </div>
  );
}
