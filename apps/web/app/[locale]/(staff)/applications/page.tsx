import { applicationsQuerySchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ClipboardList, Plus } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { Link } from "@/i18n/navigation";
import { APP_PAGE_SIZE, applicationStatusCounts, queryApplications } from "@/lib/server/applications";
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
  const [{ rows, total }, counts, districts] = await Promise.all([queryApplications(query), applicationStatusCounts(), listDistricts()]);
  const open = Object.entries(counts)
    .filter(([s]) => !["approved", "rejected", "cancelled"].includes(s))
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const all = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const tabCount = (tab: (typeof TABS)[number]) => (tab === "open" ? open : tab === "any" ? all : (counts[tab] ?? 0));
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
            action={
              viewer.can("applications.create") ? (
                <Button size="sm" asChild>
                  <Link href="/applications/new">{t("new")}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("number")}</TableHead>
                    <TableHead>{t("applicant")}</TableHead>
                    <TableHead>{t("type")}</TableHead>
                    <TableHead>{t("place")}</TableHead>
                    <TableHead>{t("statusLabel")}</TableHead>
                    <TableHead className="text-end">{t("updated")}</TableHead>
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
                      <TableCell className="text-sm">{t(`types.${a.type}`)}</TableCell>
                      <TableCell className="text-sm">
                        {a.district ? (lang === "so" ? a.district.name_so : a.district.name_en) : ""}
                        {a.neighbourhood && <span className="text-muted-foreground"> · {a.neighbourhood.name_so}</span>}
                      </TableCell>
                      <TableCell>
                        <ApplicationStatusBadge status={a.status} />
                      </TableCell>
                      <TableCell className="text-end text-xs whitespace-nowrap text-muted-foreground">
                        {format.relativeTime(new Date(a.submitted_at ?? a.created_at))}
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
                      <ApplicationStatusBadge status={a.status} />
                    </div>
                    <div className="text-sm">{a.applicant?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`types.${a.type}`)} · {a.district?.name_so}
                    </div>
                  </Link>
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
