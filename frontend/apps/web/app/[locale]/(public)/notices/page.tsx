import { BrandLockup } from "@dhulka/ui/brand";
import { Card, CardContent } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Megaphone } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { ObjectionForm } from "./objection-form";

export async function generateMetadata() {
  const t = await getTranslations("notices");
  return { title: t("title") };
}

interface Notice {
  id: string;
  application_number: string;
  district: string;
  neighbourhood: string | null;
  area_m2: number | null;
  starts_at: string;
  ends_at: string;
  outline: GeoJSON.Polygon;
}

export default async function NoticesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("notices");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([supabase.rpc("public_notices_active"), supabase.auth.getUser()]);
  const notices = (data ?? []) as Notice[];
  const signedIn = !!auth.user;

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-4xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-10">
        <p className="label-caps text-flag">{t("eyebrow")}</p>
        <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t("body")}</p>
        <div className="mt-8 space-y-5">
          {notices.length === 0 ? (
            <Card>
              <EmptyState icon={<Megaphone />} title={t("emptyTitle")} description={t("emptyBody")} />
            </Card>
          ) : (
            notices.map((n) => (
              <Card key={n.id}>
                <CardContent className="grid gap-5 pt-5 md:grid-cols-[1fr_16rem]">
                  <div className="space-y-2">
                    <p className="text-lg font-semibold">
                      {n.neighbourhood ?? "—"}, {n.district}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("application")} <Mono>{n.application_number}</Mono>
                      {n.area_m2 != null && ` · ${format.number(Number(n.area_m2), { maximumFractionDigits: 1 })} m²`}
                    </p>
                    <p className="text-sm">{t("openUntil", { date: format.dateTime(new Date(n.ends_at), { dateStyle: "long" }) })}</p>
                    <ObjectionForm noticeId={n.id} signedIn={signedIn} />
                  </div>
                  <GeometryPreview geometry={n.outline} className="h-48" />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
