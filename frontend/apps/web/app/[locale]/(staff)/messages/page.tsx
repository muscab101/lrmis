import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { CampaignTable, NewCampaign, Outbox, TemplateList } from "@/components/messages/messages-ui";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listCampaigns, listMessages, listTemplates, messageCounts, type MessageStatus } from "@/lib/server/messages";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("messages");
  return { title: t("title") };
}

const SECTIONS = ["outbox", "campaigns", "templates"] as const;
const FILTERS = ["any", "queued", "sent", "failed", "cancelled"] as const;

export default async function MessagesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "messages.view");
  const t = await getTranslations("messages");
  const sp = await searchParams;
  const section = (SECTIONS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof SECTIONS)[number]) : "outbox";
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as MessageStatus | "any") : "any";
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await messageCounts();

  let body: React.ReactNode;
  if (section === "campaigns") body = <CampaignTable rows={await listCampaigns()} me={viewer.user.id} canDecide={viewer.can("messages.approve")} />;
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
  const tabCount = { outbox: counts.queued, campaigns: counts.campaigns_draft, templates: null };
  const showNew = viewer.can("messages.create") && section !== "templates";
  const districts = showNew ? await listDistricts() : [];

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle", { sent: counts.sent_today, queued: counts.queued })}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <nav className="flex gap-5 overflow-x-auto text-sm">
            {SECTIONS.map((s) => (
              <Link
                key={s}
                href={`/messages?s=${s}`}
                className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${section === s ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t(`sections.${s}`)}
                {tabCount[s] !== null && <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{tabCount[s]}</span>}
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
