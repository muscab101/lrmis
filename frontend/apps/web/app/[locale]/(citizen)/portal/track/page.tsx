import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Check, ClipboardList } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { citizenOverview } from "@/lib/server/portal";
import { citizenApplications } from "@/lib/server/portal-track";

const STEPS = ["submitted", "fee", "survey", "checks", "notice", "registered"] as const;
const STEP_OF: Record<string, number> = { draft: -1, awaiting_payment: 1, in_survey: 2, surveyed: 3, in_verification: 3, returned: 3, public_notice: 4, approved: 6 };

export default async function TrackPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portalTrack");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const lang = await getLocale();
  const [apps, me] = await Promise.all([citizenApplications(), citizenOverview()]);
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {me.parcels.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">{t("myHouses")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {me.parcels.map((p) => (
              <li key={p.id}>
                <Link href={`/portal/parcels/${p.id}`} className="block rounded-xl border bg-card p-4 hover:border-primary">
                  <div className="flex items-center justify-between gap-3">
                    <Mono>{p.pun ?? "—"}</Mono>
                    <ParcelStatusBadge status={p.status as "registered"} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.district ? (lang === "so" ? p.district.name_so : p.district.name_en) : ""} ·{" "}
                    {p.documents.some((d) => d.type === "certificate") ? t("titleIssued") : t("noTitleYet")}
                    {Number(p.balance) > 0 && ` · ${t("owes", { amount: format.number(Number(p.balance), { style: "currency", currency: "USD" }) })}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className="mb-3 text-lg font-semibold">{t("applications")}</h2>
      {apps.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList />}
            title={t("none")}
            description={t("noneBody")}
            action={
              <Button asChild>
                <Link href="/portal/applications/new">{t("apply")}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {apps.map((a) => {
            const step = STEP_OF[a.status] ?? 0;
            const ended = a.status === "rejected" || a.status === "cancelled";
            return (
              <Card key={a.id}>
                <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      <Link href={`/portal/applications/${a.id}`} className="hover:text-primary">
                        <Mono>{a.number}</Mono>
                      </Link>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {ta(`types.${a.type}`)} · {a.district ? (lang === "so" ? a.district.name_so : a.district.name_en) : ""}
                      {a.pun && (
                        <>
                          {" "}
                          · PUN <Mono>{a.pun}</Mono>
                        </>
                      )}
                    </p>
                  </div>
                  <ApplicationStatusBadge status={a.status as "draft"} />
                </CardHeader>
                <CardContent className="space-y-4">
                  {a.status === "returned" && <Alert tone="warning" title={t("returned")} />}
                  {a.status === "draft" && <Alert tone="info" title={t("draft")} />}
                  {!ended && (
                    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-6 sm:gap-1" aria-label={t("progress")}>
                      {STEPS.map((s, i) => {
                        const done = i < step || (s === "submitted" && step >= 0);
                        const current = i === step;
                        return (
                          <li key={s} className="flex items-center gap-3 sm:block sm:text-center">
                            <div className={`flex size-7 shrink-0 items-center sm:mx-auto sm:mb-1 justify-center rounded-full border text-xs ${done ? "border-status-approved bg-status-approved text-white" : current ? "border-primary text-primary" : "text-muted-foreground"}`}>
                              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                            </div>
                            <span className={`block text-sm leading-tight sm:text-[11px] ${current ? "font-medium" : "text-muted-foreground"}`}>{t(`steps.${s}`)}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {a.events.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">{t("history", { n: a.events.length })}</summary>
                      <ol className="mt-2 space-y-1.5 border-s ps-4">
                        {a.events.map((e, i) => (
                          <li key={i}>
                            {e.to ? (ta.has(`status.${e.to}`) ? ta(`status.${e.to}`) : e.to) : t.has(`events.${e.action}`) ? t(`events.${e.action}`) : e.action}
                            <span className="ms-2 text-xs text-muted-foreground">{date(e.at)}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
