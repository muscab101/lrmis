import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Download, Hammer, MapPinned } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PlaceFilter } from "@/components/billing/place-filter";
import { DecideDemolition } from "@/components/demolitions/demolition-actions";
import { MarkDemolished } from "@/components/demolitions/mark-demolished";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { placeChoices } from "@/lib/server/billing";
import { demolitionStats, listDemolitions } from "@/lib/server/demolitions";
import { createClient } from "@/lib/supabase/server";

type Search = {
  tab?: string;
  d?: string;
  s?: string;
  k?: string;
  n?: string;
  from?: string;
  to?: string;
  q?: string;
  mark?: string;
};
const TABS = ["archive", "pending", "closed"] as const;

export async function generateMetadata() {
  const t = await getTranslations("demolitions");
  return { title: t("title") };
}

export default async function DemolishedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.demolitions");
  const t = await getTranslations("demolitions");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as (typeof TABS)[number])
    : "archive";
  const canAsk = viewer.can("parcels.demolish") || viewer.can("parcels.demolish_approve");
  const canApprove = viewer.can("parcels.demolish_approve");
  const [rows, stats, choices] = await Promise.all([
    listDemolitions({ tab, d: sp.d, s: sp.s, k: sp.k, n: sp.n, from: sp.from, to: sp.to, q: sp.q }),
    demolitionStats(),
    placeChoices({ d: sp.d, s: sp.s, k: sp.k }, lang),
  ]);
  // Opened from the map: that land is already chosen.
  const preset =
    sp.mark && /^[0-9a-f-]{36}$/i.test(sp.mark) && canAsk
      ? (((
          await (
            await createClient()
          )
            .from("parcels")
            .select("id, pun")
            .eq("id", sp.mark)
            .maybeSingle()
        ).data as { id: string; pun: string | null } | null) ?? null)
      : null;
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { dateStyle: "medium" });
  const place = (o: { name_so: string; name_en: string } | null | undefined) =>
    o ? (lang === "so" ? o.name_so : o.name_en) : "—";
  const query = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({
      tab,
      d: sp.d,
      s: sp.s,
      k: sp.k,
      n: sp.n,
      from: sp.from,
      to: sp.to,
      q: sp.q,
      ...extra,
    }))
      if (v) q.set(k, v);
    return q.toString();
  };
  const exportQuery = query({});
  const groups = [
    { title: t("byDistrict"), rows: stats.by_district },
    { title: t("bySector"), rows: stats.by_sector },
    { title: t("byNeighbourhood"), rows: stats.by_neighbourhood },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/exports/demolitions?${exportQuery}&format=xlsx`}>
                <Download aria-hidden />
                Excel
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/exports/demolitions?${exportQuery}&format=pdf`}>
                <Download aria-hidden />
                PDF
              </a>
            </Button>
            {canAsk && (
              <MarkDemolished
                key={preset?.id ?? "any"}
                canApprove={canApprove}
                preset={preset}
                openAtStart={!!preset}
                size="sm"
              />
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiChip label={t("kpiTotal")} value={format.number(stats.total)} />
        <KpiChip label={t("kpiThisYear")} value={format.number(stats.this_year)} />
        <KpiChip label={t("kpiWaiting")} value={format.number(stats.waiting)} />
        <KpiChip label={t("kpiOutstanding")} value={usd(stats.outstanding)} />
      </div>

      {stats.total > 0 && (
        <div className="mb-5 grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.title}>
              <CardHeader>
                <CardTitle className="text-sm">{g.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {g.rows.map((r) => (
                    <li key={r.name} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{lang === "so" ? r.name_so : r.name}</span>
                      <span className="font-medium tabular-nums">{format.number(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <nav className="mb-4 flex flex-wrap gap-x-5 gap-y-2 border-b text-sm" aria-label={t("title")}>
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/demolished?${query({ tab: k })}`}
            aria-current={tab === k ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2 ${tab === k ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
          >
            {t(`tab_${k}`)}
            {k === "pending" && stats.waiting > 0 && (
              <span className="text-muted-foreground ms-1 tabular-nums">{stats.waiting}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mb-4 space-y-3">
        <PlaceFilter
          levels={[
            { key: "d", options: choices.d },
            { key: "s", options: choices.s },
            { key: "k", options: choices.k },
            { key: "n", options: choices.n },
          ]}
          query={{ d: sp.d, s: sp.s, k: sp.k, n: sp.n }}
        />
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          {(["d", "s", "k", "n"] as const).map(
            (k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />,
          )}
          <label className="text-muted-foreground grid gap-1 text-xs">
            {t("search")}
            <Input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder={t("searchHint")}
              className="h-9 w-64"
            />
          </label>
          <label className="text-muted-foreground grid gap-1 text-xs">
            {t("from")}
            <Input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 w-40" />
          </label>
          <label className="text-muted-foreground grid gap-1 text-xs">
            {t("to")}
            <Input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 w-40" />
          </label>
          <Button type="submit" variant="outline" size="sm">
            {t("show")}
          </Button>
        </form>
      </div>

      {tab === "pending" && canApprove && rows.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span>{t("allWaiting", { count: rows.length })}</span>
          <DecideDemolition ids={rows.map((r) => r.id)} />
        </div>
      )}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Hammer />} title={t("none")} description={t(`noneBody_${tab}`)} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colPun")}</TableHead>
                <TableHead>{t("colHouse")}</TableHead>
                <TableHead>{t("colPlace")}</TableHead>
                <TableHead>{t("colOwners")}</TableHead>
                <TableHead>{t("colDate")}</TableHead>
                <TableHead className="text-end">{t("colOwed")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                {tab === "pending" && canApprove && (
                  <TableHead className="text-end">{t("colActions")}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/demolished/${r.id}`} className="hover:text-primary">
                      <Mono>{r.pun ?? r.number}</Mono>
                    </Link>
                    <p className="text-muted-foreground text-xs">{r.number}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.house_no ?? "—"}
                    {r.new_house_no && r.new_house_no !== r.house_no && (
                      <p className="text-muted-foreground text-xs">
                        {t("nowHouse", { no: r.new_house_no })}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 text-sm">
                    <span className="block truncate">{place(r.snapshot.district)}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {[
                        r.snapshot.section?.code,
                        r.snapshot.sector?.code,
                        r.snapshot.neighbourhood?.code,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">
                    {r.owner_names ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {day(r.demolition_date)}
                  </TableCell>
                  <TableCell
                    className={`text-end text-sm tabular-nums ${r.outstanding > 0 ? "text-danger font-medium" : ""}`}
                  >
                    {usd(r.outstanding)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <StatusBadge
                        tone={
                          r.status === "approved"
                            ? "rejected"
                            : r.status === "pending"
                              ? "pending"
                              : "draft"
                        }
                      >
                        {t(`status_${r.status}`)}
                      </StatusBadge>
                      {r.rebuilt_at && <StatusBadge tone="approved">{t("rebuilt")}</StatusBadge>}
                    </span>
                  </TableCell>
                  {tab === "pending" && canApprove && (
                    <TableCell className="text-end">
                      <DecideDemolition ids={[r.id]} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {viewer.can("map.view") && tab === "archive" && rows.length > 0 && (
        <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
          <MapPinned className="size-3.5" aria-hidden />
          {t("mapHint")}
        </p>
      )}
    </>
  );
}
