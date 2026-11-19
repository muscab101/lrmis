import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Compass, MapPin, MapPinned } from "lucide-react";
import { Button } from "@dhulka/ui/button";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { queryParcelSiteChecks, queryRemapJobs, querySiteChecks, querySurveys, surveyStatusCounts, type SurveyStatus } from "@/lib/server/surveys";
import { SiteCheckButtons } from "@/components/parcels/site-check-buttons";
import { SiteCheckActions } from "@/components/applications/site-check";
import { SurveyRowActions } from "@/components/surveys/survey-row-actions";
import { ZoneTable } from "@/components/parcels/zone-table";
import { listRemapZones, listZones } from "@/lib/server/zones";
import { RemapZoneTable } from "@/components/parcels/remap-zone-table";
import { fullHouseNo } from "@/lib/house-no";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("surveys");
  return { title: t("title") };
}

// Zones first; "Remapping" is land given to a surveyor to put where it really is on the map; "Assigned" is all a surveyor still has to do (site checks, assigned, in progress); "Submitted" is all
// waiting for a supervisor (submitted, overlap review).
const TABS = ["zones", "assigned", "remapping", "submitted", "returned", "any"] as const;
type Tab = (typeof TABS)[number];
const ASSIGNED: SurveyStatus[] = ["assigned", "in_progress"];
const SUBMITTED: SurveyStatus[] = ["submitted", "overlap_review"];
// Links from before the tabs were combined.
const OLD_TABS: Record<string, Tab> = { open: "assigned", site_checks: "assigned", in_progress: "assigned", overlap_review: "submitted" };

export default async function SurveysPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "surveys.view");
  const t = await getTranslations("surveys");
  const tp = await getTranslations("parcels");
  const format = await getFormatter();
  const lang = await getLocale();
  const nm = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en || o.name_so) : "");
  const sp = await searchParams;
  const asked = OLD_TABS[sp.status ?? ""] ?? sp.status;
  const status: Tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as Tab) : "zones";
  const mine = sp.mine === "1" || !viewer.can("surveys.approve");
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const remapNbhd = status === "remapping" ? uuid(sp.nbhd) : undefined;
  const remapSurveyor = uuid(sp.surveyor);
  const canRemapAny = viewer.can("applications.capture_location") && viewer.can("parcels.update");
  const canRemapOwn = viewer.can("applications.capture_location");
  const [rows, counts, checks, landChecks, zones, remaps, remapJobs] = await Promise.all([
    status === "zones" || status === "remapping"
      ? Promise.resolve([])
      : querySurveys({ status: status === "assigned" ? ASSIGNED : status === "submitted" ? SUBMITTED : (status as SurveyStatus | "any"), mine }),
    surveyStatusCounts(),
    querySiteChecks(mine),
    queryParcelSiteChecks(mine),
    listZones(mine),
    // Remapping: the jobs (a neighbourhood or a plot, per surveyor); with a job chosen, every plot in it.
    remapNbhd ? queryRemapJobs(mine, remapNbhd, remapSurveyor) : Promise.resolve([]),
    listRemapZones(mine),
  ]);
  const siteCan = { request: false, checkAny: viewer.can("surveys.approve"), checkOwn: viewer.can("surveys.update") };
  const sum = (keys: SurveyStatus[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const count = (tab: Tab) =>
    tab === "zones"
      ? zones.length
      : tab === "remapping"
        ? remapJobs.reduce((n, j) => n + j.total - j.done, 0)
      : tab === "assigned"
        ? checks.length + landChecks.length + sum(ASSIGNED)
        : tab === "submitted"
          ? sum(SUBMITTED)
          : tab === "any"
            ? Object.values(counts).reduce((s, n) => s + (n ?? 0), 0)
            : (counts[tab] ?? 0);
  const href = (p: Record<string, string>) => `/surveys?${new URLSearchParams({ status, ...(mine ? { mine: "1" } : {}), ...p })}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
      >
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab })}
              className={tabClass(status === tab)}
            >
              {t(`tabs.${tab}`)}
              <TabCount n={count(tab)} />
            </Link>
          ))}
        </nav>
      </PageHeader>
      {status === "zones" ? (
        <Card className="overflow-hidden">
          <ZoneTable rows={zones} me={viewer.user.id} />
        </Card>
      ) : status === "remapping" && !remapNbhd ? (
        <Card className="overflow-hidden">
          <RemapZoneTable rows={remapJobs} me={viewer.user.id} canRemapAny={canRemapAny} canRemapOwn={canRemapOwn} back="/surveys?status=remapping" />
        </Card>
      ) : status === "remapping" ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
            <Link href="/surveys?status=remapping" className="text-primary underline">
              {t("remapAllJobs")}
            </Link>
            {remaps[0]?.neighbourhood && <span className="font-medium">{nm(remaps[0].neighbourhood)}</span>}
            {remaps[0]?.surveyor && <span className="text-muted-foreground">· {remaps[0].surveyor}</span>}
            <span className="text-muted-foreground ms-auto text-xs">{t("remapLeft", { count: remaps.length })}</span>
          </div>
          {remaps.length === 0 ? (
            <EmptyState icon={<MapPinned />} title={t("remapEmptyTitle")} description={t("remapEmptyBody")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tp("pun")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("assigned")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("place")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("surveyor")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("note")}</TableHead>
                  <TableHead className="text-end">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remaps.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/parcels/${r.id}`} className="hover:text-primary">
                        <Mono>{r.pun ?? (r.house_no ? `${tp("houseNoShort")} ${fullHouseNo(r.neighbourhood?.name_so, r.house_no)}` : tp("noPun"))}</Mono>
                      </Link>
                      {r.geom_provisional && <div className="text-status-pending text-xs">{t("remapGuessed")}</div>}
                    </TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">{format.dateTime(new Date(r.remap_requested_at), { dateStyle: "medium" })}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {nm(r.district)}
                      {r.neighbourhood && <span className="text-muted-foreground"> · {nm(r.neighbourhood)}</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{r.surveyor ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-60 truncate text-sm xl:table-cell">{r.remap_note ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {/* Straight to the map to put this plot where it really is; back here after saving. */}
                        {canRemapAny || (r.remap_surveyor === viewer.user.id && canRemapOwn) ? (
                          <Button size="sm" asChild>
                            <Link href={`/parcels/${r.id}/remap?${new URLSearchParams({ back: `/surveys?${new URLSearchParams({ status: "remapping", nbhd: remapNbhd ?? "", ...(remapSurveyor ? { surveyor: remapSurveyor } : {}) })}` })}`}>
                              <MapPin aria-hidden />
                              {t("remapNow")}
                            </Link>
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/parcels/${r.id}`}>{t("remapOpen")}</Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : (
        <div className="space-y-5">
        {status === "assigned" && checks.length + landChecks.length > 0 && (
        <Card className="overflow-hidden">
          <p className="border-b px-4 py-3 text-sm font-medium">{t("tabs.site_checks")}</p>
          {(
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
                {landChecks.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-status-pending font-bold" aria-hidden>
                          ?
                        </span>
                        <Mono>{c.pun ?? (c.house_no ? `${tp("houseNoShort")} ${fullHouseNo(c.neighbourhood?.name_so, c.house_no)}` : tp("noPun"))}</Mono>
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap lg:table-cell">{format.dateTime(new Date(c.site_check_requested_at), { dateStyle: "medium" })}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {nm(c.district)}
                      {c.neighbourhood && <span className="text-muted-foreground"> · {nm(c.neighbourhood)}</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">—</TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-60 truncate text-sm xl:table-cell">{c.site_check_note ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <SiteCheckButtons
                          parcelId={c.id}
                          size="sm"
                          canRequest={false}
                          canAnswer={(c.site_check_surveyor === viewer.user.id && viewer.can("surveys.update")) || viewer.can("surveys.approve")}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {checks.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-status-pending font-bold" aria-hidden>
                          ?
                        </span>
                        <Mono>{c.number}</Mono>
                      </span>
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        )}
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
                    <SurveyRowActions
                      survey={{ id: s.id, status: s.status, surveyor_id: s.surveyor_id, application_id: s.application?.id ?? null }}
                      me={viewer.user.id}
                      can={{ update: viewer.can("surveys.update"), approve: viewer.can("surveys.approve") }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
        </div>
      )}
    </>
  );
}
