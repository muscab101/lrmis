import { BrandMark } from "@dhulka/ui/brand";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { PortalNav } from "@/components/portal/portal-nav";
import { Link } from "@/i18n/navigation";
import { requireCitizen } from "@/lib/server/auth";
import { cookies } from "next/headers";
import { WelcomeSplash } from "@/components/shell/welcome-splash";
import { WELCOME_COOKIE } from "@/lib/welcome";
import { profilePhotoUrl } from "@/lib/server/profile-photo";
import { citizenMe } from "@/lib/server/portal";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

export default async function CitizenLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireCitizen(locale);
  const t = await getTranslations("portal");
  const welcome = (await cookies()).get(WELCOME_COOKIE)?.value === "1";
  // The name on the land register (the account itself only has the phone).
  const me = await citizenMe();
  return (
    <div className="min-h-dvh">
      {welcome && <WelcomeSplash name={me?.full_name || viewer.profile.full_name} />}
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-2 font-semibold">
            <BrandMark />
            {t("title")}
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <LocaleSwitch />
            <ThemeToggle />
            <UserMenu citizen name={me?.full_name || viewer.profile.full_name || viewer.profile.phone || ""} email={viewer.profile.phone} photo={await profilePhotoUrl(viewer.profile.avatar_path)} />
          </div>
        </div>
        <PortalNav verify={viewer.can("verify.view")} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
