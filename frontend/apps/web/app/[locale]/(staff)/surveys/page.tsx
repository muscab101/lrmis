import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Button } from "@dhulka/ui/button";
import { Tooltip } from "@dhulka/ui/form-controls";
import { ClipboardList, Compass, MapPinned, Plus, UserPlus } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { querySiteChecks, querySurveys, surveyStatusCounts, type SurveyStatus } from "@/lib/server/surveys";
import { SiteCheckActions } from "@/components/applications/site-check";
import { ZoneTable } from "@/components/parcels/zone-table";
import { listZones } from "@/lib/server/zones";

export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return { title: t("title") };
}

const TABS = ["open", "zones", "site_checks", "assigned", "in_progress", "overlap_review", "returned", "submitted", "any"] as const;

export default async function SurveysPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "surveys.view");
  const t = await getTranslations("surveys");
  const format = await getFormatter();
  const lang = await getLocale();
  const nm = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en || o.name_so) : "");
  const sp = await searchParams;
  const status = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof TABS)[number]) : "open";
  const mine = sp.mine === "1" || !viewer.can("surveys.approve");
  const [rows, counts, checks, zones] = await Promise.all([
    status === "site_checks" || status === "zones" ? Promise.resolve([]) : querySurveys({ status: status as SurveyStatus | "open" | "any", mine }),
    surveyStatusCounts(),
    querySiteChecks(mine),
    listZones(mine),
  ]);
  const siteCan = { request: false, checkAny: viewer.can("surveys.approve"), checkOwn: viewer.can("surveys.update") };
  const count = (tab: (typeof TABS)[number]) =>
    tab === "site_checks"
      ? checks.length
      : tab === "zones"
      ? zones.length
      : tab === "open"
      ? (["assigned", "in_progress", "returned", "overlap_review"] as const).reduce((s, k) => s + (counts[k] ?? 0), 0)
      : tab === "any"
        ? Object.values(counts).reduce((s, n) => s + (n ?? 0), 0)
        : (counts[tab] ?? 0);
  const href = (p: Record<string, string>) => `/surveys?${new URLSearchParams({ status, ...(mine ? { mine: "1" } : {}), ...p })}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          (viewer.can("owners.create") || viewer.can("applications.create")) && (
            <div className="flex flex-wrap gap-2">
              {viewer.can("owners.create") && (
                <Button asChild variant="outline">
                  <Link href="/owners/new">
                    <UserPlus aria-hidden />
                    {t("newOwner")}
                  </Link>
                </Button>
              )}
              {viewer.can("applications.create") && (
                <Button asChild>
                  <Link href="/applications/new">
                    <Plus aria-hidden />
                    {t("newLandParcel")}
                  </Link>
                </Button>
              )}
            </div>
          )
        }
      >
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab })}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${status === tab ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${tab}`)}
              <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{count(tab)}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      {status === "zones" ? (
        <Card className="overflow-hidden">
          <ZoneTable
            rows={zones}
            me={viewer.user.id}
            canManage={viewer.can("surveys.approve")}
            canAddLand={viewer.can("surveys.create") || viewer.can("applications.create")}
          />
        </Card>
      ) : status === "site_checks" ? (
        <Card className="overflow-hidden">
          {checks.length === 0 ? (
            <EmptyState icon={<Compass />} title={t("noSiteChecks")} description={t("noSiteChecksBody")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("application")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("requested")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("place")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("applicant")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("note")}</TableHead>
                  <TableHead className="text-end">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/applications/${c.id}`} className="hover:text-primary inline-flex items-center gap-1.5">
                        <span className="text-status-pending font-bold" aria-hidden>
                          ?
                        </span>
                        <Mono>{c.number}</Mono>
                      </Link>
                      {c.plot_no && <div className="text-muted-foreground text-xs">{c.plot_no}</div>}
                    </TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">{format.dateTime(new Date(c.site_check_requested_at), { dateStyle: "medium" })}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {nm(c.district)}
                      {c.neighbourhood && <span className="text-muted-foreground"> · {nm(c.neighbourhood)}</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{c.applicant?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-60 truncate text-sm xl:table-cell">{c.site_check_note ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <SiteCheckActions application={{ ...c, site_check_status: "pending" }} me={viewer.user.id} can={siteCan} />
                        <Tooltip content={t("actionApplication")}>
                          <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
                            <Link href={`/applications/${c.id}`} aria-label={t("actionApplication")}>
                              <ClipboardList aria-hidden />
                            </Link>
                          </Button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : (
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Compass />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("application")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("assigned")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("place")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("surveyor")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="hidden text-end md:table-cell">{t("due")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/surveys/${s.id}`} className="hover:text-primary">
                      <Mono>{s.application?.number ?? "—"}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">{format.dateTime(new Date(s.assigned_at), { dateStyle: "medium" })}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {nm(s.application?.district)}
                    {s.application?.neighbourhood && <span className="text-muted-foreground"> · {nm(s.application.neighbourhood)}</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{s.surveyor?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{t(`status.${s.status}`)}</TableCell>
                  <TableCell className="hidden text-end text-xs text-muted-foreground md:table-cell">{s.due_date ? format.dateTime(new Date(s.due_date), { dateStyle: "medium" }) : "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Tooltip content={t("actionOpen")}>
                        <Button asChild variant="ghost" size="icon-sm" className="text-primary">
                          <Link href={`/surveys/${s.id}`} aria-label={t("actionOpen")}>
                            <MapPinned aria-hidden />
                          </Link>
                        </Button>
                      </Tooltip>
                      {s.application && (
                        <Tooltip content={t("actionApplication")}>
                          <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
                            <Link href={`/applications/${s.application.id}`} aria-label={t("actionApplication")}>
                              <ClipboardList aria-hidden />
                            </Link>
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      )}
    </>
  );
}
