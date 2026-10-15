import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, KpiChip, PageHeader } from "@dhulka/ui/misc";
import { CheckCircle2, Circle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const PHASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const t = await getTranslations("dashboard");
  const supabase = await createClient();

  const canUsers = viewer.can("users.view");
  const [staff, invited, roles, districts] = await Promise.all([
    canUsers ? supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", "active") : null,
    canUsers ? supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", "invited") : null,
    supabase.from("roles").select("*", { count: "exact", head: true }),
    supabase.from("districts").select("*", { count: "exact", head: true }).is("deleted_at", null),
  ]);

  const firstName = viewer.profile.full_name.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat(locale === "so" ? "so-SO" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
        title={t("greeting", { name: firstName })}
        description={t("subtitle")}
      >
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {canUsers && <KpiChip label={t("kpiActiveStaff")} value={staff?.count ?? "—"} />}
          {canUsers && <KpiChip label={t("kpiInvited")} value={invited?.count ?? "—"} tone={(invited?.count ?? 0) > 0 ? "warning" : "default"} />}
          <KpiChip label={t("kpiRoles")} value={roles.count ?? "—"} />
          <KpiChip label={t("kpiDistricts")} value={districts.count ?? "—"} />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("roadmapTitle")}</CardTitle>
            <CardDescription>{t("roadmapBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid sm:grid-cols-2 sm:gap-x-8">
              {PHASES.map((p) => (
                <li key={p} className="flex items-start gap-3 border-b py-3 text-sm">
                  <span className={`w-6 shrink-0 pt-0.5 font-mono text-xs ${p === 1 ? "text-success" : "text-muted-foreground"}`}>
                    {String(p).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t(`phases.p${p}.title`)}</div>
                    <div className="text-xs text-muted-foreground">{t(`phases.p${p}.body`)}</div>
                  </div>
                  {p === 1 ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label={t("done")} />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-border" aria-label={t("planned")} />
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("securityTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                {viewer.aal === "aal2" ? t("mfaOn") : t("mfaOff")}
              </p>
              <p className="text-muted-foreground">{t("securityBody")}</p>
              <Link href="/change-password" className="text-primary hover:underline">
                {t("changePassword")}
              </Link>
            </CardContent>
          </Card>
          {canUsers && (invited?.count ?? 0) > 0 && (
            <Alert tone="warning" title={t("invitedAlertTitle", { count: invited?.count ?? 0 })}>
              <Link href="/admin/users?status=invited" className="underline">
                {t("invitedAlertLink")}
              </Link>
            </Alert>
          )}
        </div>
      </div>
    </>
  );
}
