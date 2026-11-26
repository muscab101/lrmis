import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { CampaignDetailHeader } from "@/components/messages/campaign-detail";
import { Outbox } from "@/components/messages/messages-ui";
import { tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { campaignMessages, getCampaign, type MessageStatus } from "@/lib/server/messages";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("messages.history");
  return { title: `${t("detailTitle")} ${id.slice(0, 8)}` };
}

const FILTERS = ["any", "sent", "failed", "queued", "cancelled"] as const;

/** One campaign: what was sent, to whom, how it went, and each owner's message. */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "messages.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getCampaign(id);
  if (!c) notFound();
  const t = await getTranslations("messages.history");
  const tm = await getTranslations("messages");
  const format = await getFormatter();
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as MessageStatus | "any") : "any";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await campaignMessages(id, filter, page);
  const can = { retry: viewer.can("messages.update"), cancel: viewer.can("messages.cancel") };
  const canExport = viewer.can("messages.export");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/messages?s=history" className="hover:underline">
            {t("back")}
          </Link>
        }
        title={<CampaignDetailHeader campaign={c} can={can} />}
      >
        <div className="flex flex-wrap gap-8">
          <KpiChip label={t("recipients")} value={c.total || c.recipients} />
          <KpiChip label={t("delivered")} value={c.sent} tone="success" />
          <KpiChip label={t("failed")} value={c.failed} tone={c.failed ? "danger" : "default"} />
          <KpiChip label={t("waiting")} value={c.waiting} tone={c.waiting ? "warning" : "default"} />
          <KpiChip label={t("cancelledN")} value={c.cancelled} />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b p-3">
            <nav className="flex flex-wrap gap-4 text-sm">
              {FILTERS.map((f) => (
                <Link key={f} href={`/messages/${id}?f=${f}`} className={tabClass(filter === f)}>
                  {f === "any" ? tm("all") : tm(`status.${f}`)}
                </Link>
              ))}
            </nav>
            {canExport && (
              <div className="ms-auto flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/exports/messages?campaign=${id}&format=xlsx`}>
                    <Download aria-hidden />
                    Excel
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/exports/messages?campaign=${id}&format=pdf`}>
                    <Download aria-hidden />
                    PDF
                  </a>
                </Button>
              </div>
            )}
          </div>
          <Outbox rows={rows} can={{ retry: can.retry, cancel: can.cancel }} />
          <Pager page={page} pages={Math.max(1, Math.ceil(total / 50))} href={(p) => `/messages/${id}?f=${filter}&page=${p}`} />
        </Card>

        <Card className="lg:self-start">
          <CardHeader>
            <CardTitle className="text-sm">{t("about")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label={t("number")}>
                <Mono>{c.number}</Mono>
              </Row>
              {c.category && <Row label={tm("compose.category")}>{tm(`compose.categories.${c.category}`)}</Row>}
              {c.lang && <Row label={tm("compose.language")}>{c.lang === "en" ? "English" : "Soomaali"}</Row>}
              {c.kind === "compose" && (
                <Row label={t("channel")}>
                  {c.channel === "email" ? "Email" : "SMS"}
                  {c.per_parcel && ` · ${t("perParcel")}`}
                </Row>
              )}
              <Row label={t("sender")}>{c.sender ?? "—"}</Row>
              <Row label={t("created")}>{format.dateTime(new Date(c.created_at), { dateStyle: "medium", timeStyle: "short" })}</Row>
              {c.scheduled_at && <Row label={t("scheduledFor")}>{format.dateTime(new Date(c.scheduled_at), { dateStyle: "medium", timeStyle: "short" })}</Row>}
              {c.kind === "compose" && (
                <Row label={t("type")}>{c.target?.all ? t("allOwners") : c.areas && c.areas.length > 0 ? t("typeAreas") : t("typeOwners")}</Row>
              )}
              {c.areas && c.areas.length > 0 && (
                <Row label={t("to")}>
                  <ul className="space-y-0.5">
                    {c.areas.map((a) => (
                      <li key={`${a.level}${a.code}`}>
                        <span className="text-muted-foreground">{tm(`compose.levels.${a.level}`)}</span> {locale === "so" ? a.name_so : a.name_en}
                      </li>
                    ))}
                  </ul>
                </Row>
              )}
              {c.body && (
                <Row label={tm("compose.body")}>
                  <p className="rounded-md border bg-muted/40 p-2.5 whitespace-pre-wrap">{c.body}</p>
                </Row>
              )}
              {c.note && <Row label={t("note")}>{c.note}</Row>}
              {c.decision_note && <Row label={t("decisionNote")}>{c.decision_note}</Row>}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-caps text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
