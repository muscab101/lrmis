import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { CampaignTable, NewCampaign, Outbox, TemplateList } from "@/components/messages/messages-ui";
import { WarningComposer } from "@/components/messages/warning-composer";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listCampaigns, listMessages, listTemplates, listWarnings, messageCounts, type MessageStatus } from "@/lib/server/messages";
import { myDistricts } from "@/lib/server/scope";
import { listDistricts } from "@/lib/server/users";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("messages");
  return { title: t("title") };
}

const SECTIONS = ["outbox", "campaigns", "templates", "warning"] as const;
const FILTERS = ["any", "queued", "sent", "failed", "cancelled"] as const;

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "messages.view");
  const t = await getTranslations("messages");
  const sp = await searchParams;
  // The warning to every screen is for admins only.
  const sections = SECTIONS.filter((s) => s !== "warning" || viewer.can("messages.broadcast"));
  const section = (sections as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof SECTIONS)[number]) : "outbox";
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as MessageStatus | "any") : "any";
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await messageCounts();

  let body: React.ReactNode;
  if (section === "warning") {
    const [recent, places] = await Promise.all([listWarnings(), myDistricts()]);
    body = <WarningComposer recent={recent} districts={places.map((d) => ({ id: d.id, name: locale === "so" ? d.name_so : d.name_en }))} />;
  }
  else if (section === "campaigns") body = <CampaignTable rows={await listCampaigns()} me={viewer.user.id} canDecide={viewer.can("messages.approve")} />;
  else if (section === "templates") body = <TemplateList rows={await listTemplates()} canEdit={viewer.can("messages.update")} />;
  else {
    const q = (sp.q ?? "").replace(/[^\d+]/g, "").slice(0, 16);
    const { rows, total } = await listMessages(filter, q, page);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {FILTERS.map((f) => (
              <Link key={f} href={`/messages?f=${f}`} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "any" ? t("all") : t(`status.${f}`)}
                {f === "failed" && counts.failed > 0 && <span className="ms-1.5 font-mono text-[11px] text-status-rejected">{counts.failed}</span>}
              </Link>
            ))}
          </nav>
          <form className="ms-auto" role="search">
            <input type="hidden" name="f" value={filter} />
            <Input name="q" defaultValue={q} inputMode="tel" placeholder={t("searchPhone")} aria-label={t("searchPhone")} className="w-56" />
          </form>
        </div>
        <Outbox rows={rows} can={{ retry: viewer.can("messages.update"), cancel: viewer.can("messages.cancel") }} />
        <Pager page={page} pages={Math.max(1, Math.ceil(total / 50))} href={(p) => `/messages?f=${filter}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />
      </>
    );
  }
  const tabCount = { outbox: counts.queued, campaigns: counts.campaigns_draft, templates: null, warning: null };
  const showNew = viewer.can("messages.create") && section !== "templates" && section !== "warning";
  const districts = showNew ? await listDistricts() : [];

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle", { sent: counts.sent_today, queued: counts.queued })}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <nav className="flex gap-5 overflow-x-auto text-sm">
            {sections.map((s) => (
              <Link
                key={s}
                href={`/messages?s=${s}`}
                className={tabClass(section === s)}
              >
                {t(`sections.${s}`)}
                {tabCount[s] !== null && <TabCount n={tabCount[s]} />}
              </Link>
            ))}
          </nav>
          {showNew && <NewCampaign districts={districts} allDistricts={Boolean((viewer.profile as { all_districts?: boolean }).all_districts) || viewer.isSuperAdmin} />}
        </div>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      <p className="mt-2 text-xs text-muted-foreground">{t("hint")}</p>
    </>
  );
}
