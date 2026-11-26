import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { PageHeader } from "@dhulka/ui/misc";
import { Download, PenSquare } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { CampaignHistory } from "@/components/messages/history";
import { Outbox, TemplateList } from "@/components/messages/messages-ui";
import { WarningComposer } from "@/components/messages/warning-composer";
import { TabCount, tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import {
  CAMPAIGN_STATES,
  type CampaignState,
  listCampaignHistory,
  listMessages,
  listTemplates,
  listWarnings,
  MESSAGE_CATEGORIES,
  type MessageCategory,
  messageCounts,
  type MessageStatus,
} from "@/lib/server/messages";
import { myDistricts } from "@/lib/server/scope";

export async function generateMetadata() {
  const t = await getTranslations("messages");
  return { title: t("title") };
}

const SECTIONS = ["history", "scheduled", "outbox", "templates", "warning"] as const;
const FILTERS = ["any", "queued", "sent", "failed", "cancelled"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "messages.view");
  const t = await getTranslations("messages");
  const sp = await searchParams;
  // The warning to every screen is for admins only.
  const sections = SECTIONS.filter((s) => s !== "warning" || viewer.can("messages.broadcast"));
  const section = (sections as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof SECTIONS)[number]) : "history";
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await messageCounts();
  const can = { decide: viewer.can("messages.approve"), retry: viewer.can("messages.update"), cancel: viewer.can("messages.cancel") };

  let body: React.ReactNode;
  let scheduledCount: number | null = null;
  if (section === "warning") {
    const [recent, places] = await Promise.all([listWarnings(), myDistricts()]);
    body = <WarningComposer recent={recent} districts={places.map((d) => ({ id: d.id, name: locale === "so" ? d.name_so : d.name_en }))} />;
  } else if (section === "history" || section === "scheduled") {
    const q = (sp.q ?? "").slice(0, 80);
    const state = section === "scheduled" ? "scheduled" : (CAMPAIGN_STATES as readonly string[]).includes(sp.state ?? "") ? (sp.state as CampaignState) : undefined;
    const category = (MESSAGE_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? (sp.category as MessageCategory) : undefined;
    const from = DATE.test(sp.from ?? "") ? sp.from : undefined;
    const to = DATE.test(sp.to ?? "") ? sp.to : undefined;
    const { rows, total } = await listCampaignHistory({ q, state, category, from, to, page, size: 25 });
    const keep = new URLSearchParams(Object.entries({ s: section, q, state: section === "history" ? (state ?? "") : "", category: category ?? "", from: from ?? "", to: to ?? "" }).filter(([, v]) => v));
    const exportHref = (format: string) => {
      const p = new URLSearchParams(keep);
      p.delete("s");
      if (section === "scheduled") p.set("state", "scheduled");
      p.set("format", format);
      return `/api/exports/messages?${p.toString()}`;
    };
    body = (
      <>
        <form className="flex flex-wrap items-end gap-2 border-b p-3" role="search">
          <input type="hidden" name="s" value={section} />
          <Input name="q" defaultValue={q} placeholder={t("history.search")} aria-label={t("history.search")} className="w-56" />
          {section === "history" && (
            <NativeSelect name="state" defaultValue={state ?? ""} aria-label={t("history.state")} className="w-40">
              <option value="">{t("history.anyState")}</option>
              {CAMPAIGN_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`history.states.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect name="category" defaultValue={category ?? ""} aria-label={t("compose.category")} className="w-48">
            <option value="">{t("history.anyCategory")}</option>
            {MESSAGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`compose.categories.${c}`)}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" name="from" defaultValue={from} aria-label={t("history.from")} className="w-40" />
          <Input type="date" name="to" defaultValue={to} aria-label={t("history.toDate")} className="w-40" />
          <Button type="submit" size="sm" variant="outline">
            {t("history.filter")}
          </Button>
          {viewer.can("messages.export") && (
            <span className="ms-auto flex gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={exportHref("xlsx")}>
                  <Download aria-hidden />
                  Excel
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={exportHref("pdf")}>
                  <Download aria-hidden />
                  PDF
                </a>
              </Button>
            </span>
          )}
        </form>
        <CampaignHistory rows={rows} me={viewer.user.id} can={can} />
        <Pager
          page={page}
          pages={Math.max(1, Math.ceil(total / 25))}
          href={(p) => {
            const x = new URLSearchParams(keep);
            x.set("page", String(p));
            return `/messages?${x.toString()}`;
          }}
        />
      </>
    );
    if (section === "scheduled") scheduledCount = total;
  } else if (section === "templates") {
    body = <TemplateList rows={await listTemplates()} canEdit={viewer.can("messages.update")} />;
  } else {
    const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as MessageStatus | "any") : "any";
    const q = (sp.q ?? "").replace(/[^\d+]/g, "").slice(0, 16);
    const { rows, total } = await listMessages(filter, q, page);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {FILTERS.map((f) => (
              <Link key={f} href={`/messages?s=outbox&f=${f}`} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "any" ? t("all") : t(`status.${f}`)}
                {f === "failed" && counts.failed > 0 && <span className="ms-1.5 font-mono text-[11px] text-status-rejected">{counts.failed}</span>}
              </Link>
            ))}
          </nav>
          <form className="ms-auto" role="search">
            <input type="hidden" name="s" value="outbox" />
            <input type="hidden" name="f" value={filter} />
            <Input name="q" defaultValue={q} inputMode="tel" placeholder={t("searchPhone")} aria-label={t("searchPhone")} className="w-56" />
          </form>
        </div>
        <Outbox rows={rows} can={{ retry: can.retry, cancel: can.cancel }} />
        <Pager page={page} pages={Math.max(1, Math.ceil(total / 50))} href={(p) => `/messages?s=outbox&f=${filter}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />
      </>
    );
  }
  const tabCount: Record<(typeof SECTIONS)[number], number | null> = {
    history: counts.campaigns_draft || null,
    scheduled: scheduledCount,
    outbox: counts.queued,
    templates: null,
    warning: null,
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { sent: counts.sent_today, queued: counts.queued })}
        actions={
          viewer.can("messages.create") && (
            <Button asChild>
              <Link href="/messages/compose">
                <PenSquare aria-hidden />
                {t("compose.title")}
              </Link>
            </Button>
          )
        }
      >
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {sections.map((s) => (
            <Link key={s} href={`/messages?s=${s}`} className={tabClass(section === s)}>
              {t(`sections.${s}`)}
              {tabCount[s] !== null && tabCount[s] !== 0 && <TabCount n={tabCount[s]!} />}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      <p className="mt-2 text-xs text-muted-foreground">{t("hint")}</p>
    </>
  );
}
