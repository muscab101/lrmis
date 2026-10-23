import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { MapPinOff } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { ZoneAssigner } from "@/components/parcels/zone-assigner";
import { ZoneTable } from "@/components/parcels/zone-table";
import { neighbourhoodStatus } from "@/lib/server/parcels";
import { listZones, zonePlaces } from "@/lib/server/zones";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("yetToRegister");
  return { title: t("title") };
}

const TABS = ["zones", "waiting", "not_started"] as const;
type Tab = (typeof TABS)[number];

/**
 * Assign neighbourhoods to surveyors (district → section → sector → neighbourhood, its capacity, the
 * surveyor), follow the assigned zones, and see where land is waiting or nothing is registered yet.
 */
export default async function YetToRegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.yet_to_register");
  const t = await getTranslations("yetToRegister");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  // Survey zones are for survey staff; everyone else starts on the neighbourhoods still waiting.
  const seesZones = viewer.can("surveys.view");
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") && (sp.tab !== "zones" || seesZones) ? (sp.tab as Tab) : seesZones ? "zones" : "waiting";
  const supabase = await createClient();
  const [all, { data: mine }] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids")]);
  const allowed = new Set((mine as string[] | null) ?? []);
  const districts = all.filter((d) => allowed.has(d.id));
  const district = districts.some((d) => d.id === sp.district) ? sp.district! : "";
  const canAssign = viewer.can("surveys.approve");
  const [status, zones, places] = await Promise.all([
    neighbourhoodStatus(district || null),
    seesZones ? listZones(!canAssign, sp.closed === "1" ? "any" : "open") : Promise.resolve([]),
    canAssign ? zonePlaces(districts.map((d) => d.id)) : Promise.resolve(null),
  ]);
  const shownZones = district ? zones.filter((z) => z.district_id === district) : zones;
  const openZoneBy = new Map(zones.filter((z) => z.status === "open").map((z) => [z.neighbourhood_id, z.surveyor ?? ""]));
  const statusById = Object.fromEntries(status.map((r) => [r.id, { partial: r.partial, registered: r.registered, openZone: openZoneBy.get(r.id) ?? null }]));
  const waiting = status.filter((r) => r.partial > 0 || r.open_applications > 0).sort((a, b) => b.partial + b.open_applications - (a.partial + a.open_applications));
  const notStarted = status.filter((r) => r.registered === 0);
  const rows = tab === "not_started" ? notStarted : waiting;
  const counts: Record<Tab, number> = { zones: shownZones.filter((z) => z.status === "open").length, waiting: waiting.length, not_started: notStarted.length };
  const name = (o: { name_so: string; name_en: string }) => (lang === "so" ? o.name_so : o.name_en);
  const href = (k: Tab) => `/parcels/yet-to-register?${new URLSearchParams({ tab: k, ...(district ? { district } : {}) })}`;
  const n = (v: number) => format.number(v);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t(`body_${tab}`)}
      >
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("title")}>
          {TABS.filter((k) => k !== "zones" || seesZones).map((k) => (
            <Link
              key={k}
              href={href(k)}
              aria-current={tab === k ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
            >
              {t(`tab_${k}`)} <span className="text-muted-foreground tabular-nums">{counts[k]}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      {canAssign && places && (
        <Card className="mb-5" id="assign">
          <CardHeader>
            <CardTitle className="text-base">{t("assign.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ZoneAssigner
              key={sp.assign ?? ""}
              districts={districts}
              sections={places.sections}
              sectors={places.sectors}
              neighbourhoods={places.neighbourhoods}
              status={statusById}
              initialNeighbourhood={sp.assign && /^[0-9a-f-]{36}$/i.test(sp.assign) ? sp.assign : null}
            />
          </CardContent>
        </Card>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiChip label={t("kpiPartial")} value={n(status.reduce((s, r) => s + r.partial, 0))} />
        <KpiChip label={t("kpiApplications")} value={n(status.reduce((s, r) => s + r.open_applications, 0))} />
        <KpiChip label={t("kpiNotStarted")} value={n(notStarted.length)} />
      </div>
      <Card className="overflow-hidden">
        {districts.length > 1 && (
          <form className="flex flex-wrap items-center gap-3 border-b p-3">
            <input type="hidden" name="tab" value={tab} />
            <NativeSelect name="district" defaultValue={district} className="w-auto min-w-44" aria-label={t("district")}>
              <option value="">{t("allDistricts")}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {name(d)}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              {t("apply")}
            </Button>
          </form>
        )}
        {tab === "zones" && (
          <div className="border-b px-3 py-2 text-xs">
            <Link href={`/parcels/yet-to-register?${new URLSearchParams({ tab: "zones", ...(district ? { district } : {}), ...(sp.closed === "1" ? {} : { closed: "1" }) })}`} className="text-primary underline">
              {sp.closed === "1" ? t("zones.hideClosed") : t("zones.showClosed")}
            </Link>
          </div>
        )}
        {tab === "zones" ? (
          <ZoneTable rows={shownZones} me={viewer.user.id} canManage={canAssign} canAddLand={false} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<MapPinOff />} title={t(`empty_${tab}`)} description={t(`emptyBody_${tab}`)} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("neighbourhood")}</TableHead>
                <TableHead>{t("district")}</TableHead>
                <TableHead className="text-end">{t("partial")}</TableHead>
                <TableHead className="hidden text-end md:table-cell">{t("applications")}</TableHead>
                <TableHead className="text-end">{t("registered")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("boundary")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    {name(r)}
                    <Mono className="text-muted-foreground ms-2 text-xs">{r.code}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{lang === "so" ? r.district_so : r.district_en}</TableCell>
                  <TableCell className={`text-end text-sm tabular-nums ${r.partial > 0 ? "font-medium" : "text-muted-foreground"}`}>{n(r.partial)}</TableCell>
                  <TableCell className="hidden text-end text-sm tabular-nums md:table-cell">{n(r.open_applications)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{n(r.registered)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.has_boundary ? t("yes") : <span className="text-status-pending">{t("no")}</span>}</TableCell>
                  <TableCell className="text-end text-sm whitespace-nowrap">
                    <span className="inline-flex gap-3">
                      {canAssign && !openZoneBy.has(r.id) && (
                        <Link href={`/parcels/yet-to-register?${new URLSearchParams({ tab, ...(district ? { district } : {}), assign: r.id })}#assign`} className="text-primary underline">
                          {t("assignZone")}
                        </Link>
                      )}
                      {r.partial + r.registered > 0 && (
                        <Link href={`/parcels?${new URLSearchParams({ stage: r.partial > 0 ? "draft" : "registered", nbhd: r.id })}`} className="text-primary underline">
                          {t("showLand")}
                        </Link>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
