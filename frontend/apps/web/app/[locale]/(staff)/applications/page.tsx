import { applicationsQuerySchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ClipboardList, Plus } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { ApplicationRowActions } from "@/components/applications/application-row-actions";
import { SiteCheckMark } from "@/components/applications/site-check";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { Link } from "@/i18n/navigation";
import { APP_PAGE_SIZE, officeApplicationStatusCounts, queryApplications } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { ApplicationsFilters } from "./applications-filters";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("title") };
}

const TABS = ["open", "draft", "awaiting_payment", "returned", "approved", "rejected", "cancelled", "any"] as const;

export default async function ApplicationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "applications.view");
  const t = await getTranslations("applications");
  const format = await getFormatter();
  const lang = await getLocale();
  const query = applicationsQuerySchema.parse(await searchParams);
  // Transfers, subdivisions, merges, reprints, permits and corrections; new land comes in through survey zones.
  const [{ rows, total }, counts, districts] = await Promise.all([queryApplications(query, { excludeNewRegistration: true }), officeApplicationStatusCounts(), listDistricts()]);
  const open = Object.entries(counts)
    .filter(([s]) => !["approved", "rejected", "cancelled"].includes(s))
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const all = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const tabCount = (tab: (typeof TABS)[number]) => (tab === "open" ? open : tab === "any" ? all : (counts[tab] ?? 0));
  const rowCan = { update: viewer.can("applications.update"), cancel: viewer.can("applications.cancel"), checkAny: viewer.can("surveys.approve"), checkOwn: viewer.can("surveys.update"), register: viewer.can("parcels.approve") };
  const nbhdName = (n: { name_so: string; name_en: string } | null) => (n ? (lang === "so" ? n.name_so : n.name_en || n.name_so) : "");
  const href = (patch: Record<string, string | number>) => `/applications?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])), page: "1", ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          viewer.can("applications.create") && (
            <Button asChild>
              <Link href="/applications/new">
                <Plus aria-hidden />
                {t("new")}
              </Link>
            </Button>
          )
        }
      >
        <nav className="flex gap-5 overflow-x-auto text-sm" aria-label={t("statusLabel")}>
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${query.status === tab ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              aria-current={query.status === tab ? "page" : undefined}
            >
              {t(`tabs.${tab}`)}
              <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{tabCount(tab)}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>

      <Card className="overflow-hidden">
        <ApplicationsFilters query={query} districts={districts} total={total} />
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("number")}</TableHead>
                    <TableHead>{t("applicant")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("type")}</TableHead>
                    <TableHead>{t("place")}</TableHead>
                    <TableHead>{t("statusLabel")}</TableHead>
                    <TableHead className="hidden text-end lg:table-cell">{t("updated")}</TableHead>
                    <TableHead className="text-end">{t("actionsColumn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link href={`/applications/${a.id}`} className="hover:text-primary">
                          <Mono>{a.number}</Mono>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{a.applicant?.full_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">{t(`types.${a.type}`)}</TableCell>
                      <TableCell className="text-sm">
                        {a.district ? (lang === "so" ? a.district.name_so : a.district.name_en) : ""}
                        {a.neighbourhood && <span className="text-muted-foreground"> · {nbhdName(a.neighbourhood)}</span>}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <ApplicationStatusBadge status={a.status} />
                          <SiteCheckMark status={a.site_check_status} />
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-end text-xs whitespace-nowrap text-muted-foreground lg:table-cell">
                        {format.relativeTime(new Date(a.submitted_at ?? a.created_at))}
                      </TableCell>
                      <TableCell>
                        <ApplicationRowActions application={a} me={viewer.user.id} can={rowCan} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/applications/${a.id}`} className="block space-y-1 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Mono>{a.number}</Mono>
                      <span className="flex items-center gap-1.5">
                        <ApplicationStatusBadge status={a.status} />
                        <SiteCheckMark status={a.site_check_status} />
                      </span>
                    </div>
                    <div className="text-sm">{a.applicant?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`types.${a.type}`)} · {a.district ? (lang === "so" ? a.district.name_so : a.district.name_en) : ""}
                    </div>
                  </Link>
                  <div className="px-3 pb-2">
                    <ApplicationRowActions application={a} me={viewer.user.id} can={rowCan} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pager page={query.page} pages={Math.max(1, Math.ceil(total / APP_PAGE_SIZE))} href={(p) => href({ page: p })} />
      </Card>
    </>
  );
}
