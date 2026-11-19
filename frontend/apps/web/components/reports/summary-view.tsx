import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { cn } from "@dhulka/ui/lib/cn";
import { ArrowDownLeft, Banknote, FileSpreadsheet, FileText, Home, Info, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AutoSubmitForm } from "@/components/forms/auto-submit-form";
import { AreaFilter } from "@/components/reports/area-filter";
import { segClass, segGroupClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import { reportTable } from "@/lib/server/report-table";
import { AREA_REPORTS, DISTRICT_REPORTS, type ReportName, reportSummary, runReport } from "@/lib/server/reports";

/** What "Less data" shows: every figure, or one subject. */
export const SUMMARY_TOPICS = ["all", "money", "owed", "land", "people"] as const;
export type SummaryTopic = (typeof SUMMARY_TOPICS)[number];
export const summaryTopic = (v: string | undefined): SummaryTopic =>
  (SUMMARY_TOPICS as readonly string[]).includes(v ?? "") ? (v as SummaryTopic) : "all";

/** "Less data" / "More data": the switch at the top of the Reports page. */
export async function DetailSwitch({ detail, lessHref, moreHref }: { detail: "less" | "more"; lessHref: string; moreHref: string }) {
  const t = await getTranslations("reports");
  return (
    <nav className={segGroupClass} aria-label={t("detailLabel")}>
      <Link href={lessHref} aria-current={detail === "less" ? "page" : undefined} className={segClass(detail === "less")}>
        {t("detailLess")}
      </Link>
      <Link href={moreHref} aria-current={detail === "more" ? "page" : undefined} className={segClass(detail === "more")}>
        {t("detailMore")}
      </Link>
    </nav>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

type AreaProps = React.ComponentProps<typeof AreaFilter>;

/** Reports → "Less data": the period's key figures on one page, for the viewer's districts or a place inside them. */
export async function SummaryView({
  from,
  to,
  topic,
  place,
  districts,
  places,
}: {
  from: string;
  to: string;
  topic: SummaryTopic;
  place: { district: string; section: string; sector: string; nbhd: string };
  districts: AreaProps["districts"];
  places: { sections: AreaProps["sections"]; sectors: AreaProps["sectors"]; neighbourhoods: AreaProps["neighbourhoods"] };
}) {
  const t = await getTranslations("reports");
  const format = await getFormatter();
  const s = await reportSummary(from, to, {
    district: place.district || null,
    section: place.section || null,
    sector: place.sector || null,
    neighbourhood: place.nbhd || null,
  });
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const count = (n: number) => format.number(Number(n));
  // The books keep expenses per district, not per section or neighbourhood.
  const belowDistrict = Boolean(place.section || place.sector || place.nbhd);
  const left = Number(s.collected) - Number(s.expenses);
  const shows = (k: Exclude<SummaryTopic, "all">) => topic === "all" || topic === k;

  return (
    <div className="space-y-6">
      <AutoSubmitForm className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="d" value="less" />
        <input type="hidden" name="show" value={topic} />
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">{t("from")}</span>
          <Input type="date" name="from" defaultValue={from} className="w-40" />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">{t("to")}</span>
          <Input type="date" name="to" defaultValue={to} className="w-40" />
        </label>
        <AreaFilter
          key={`${place.district}/${place.section}/${place.sector}/${place.nbhd}`}
          districts={districts}
          sections={places.sections}
          sectors={places.sectors}
          neighbourhoods={places.neighbourhoods}
          initial={place}
        />
      </AutoSubmitForm>

      {shows("money") && (
        <Group icon={<Banknote />} title={t("summary.money")}>
          <Tile label={t("summary.moneyIn")} value={usd(s.collected)} sub={t("summary.payments", { n: count(s.payments) })} tone="good" />
          <Tile
            label={t("summary.moneyOut")}
            value={belowDistrict ? "—" : usd(s.expenses)}
            sub={belowDistrict ? t("summary.moneyOutDistrictOnly") : t("summary.moneyOutSub")}
            tone={belowDistrict ? undefined : "bad"}
          />
          <Tile
            label={t("summary.left")}
            value={belowDistrict ? "—" : usd(left)}
            sub={t("summary.leftSub")}
            tone={!belowDistrict && left < 0 ? "bad" : undefined}
          />
          <Tile label={t("summary.billed")} value={usd(s.billed)} sub={t("summary.billsIssued", { n: count(s.bills_issued), paid: count(s.bills_paid) })} />
        </Group>
      )}

      {shows("owed") && (
        <Group icon={<ArrowDownLeft />} title={t("summary.owed")}>
          <Tile label={t("summary.outstanding")} value={usd(s.outstanding)} sub={t("summary.outstandingSub")} tone="warn" />
          <Tile label={t("summary.overdue")} value={usd(s.overdue)} sub={t("summary.overdueSub")} tone={Number(s.overdue) > 0 ? "bad" : undefined} />
        </Group>
      )}

      {shows("land") && (
        <Group icon={<Home />} title={t("summary.land")}>
          <Tile label={t("summary.registered")} value={count(s.land_registered)} sub={t("summary.registeredNew", { n: count(s.land_registered_new) })} />
          <Tile label={t("summary.partial")} value={count(s.land_partial)} sub={t("summary.partialSub")} />
          <Tile label={t("summary.toCheck")} value={count(s.land_to_check)} sub={t("summary.toCheckSub")} />
          <Tile label={t("summary.demolished")} value={count(s.land_demolished)} />
        </Group>
      )}

      {shows("people") && (
        <Group icon={<Users />} title={t("summary.people")}>
          <Tile label={t("summary.owners")} value={count(s.owners)} sub={t("summary.ownersNew", { n: count(s.owners_new) })} />
          <Tile label={t("summary.certificates")} value={count(s.certificates)} sub={t("summary.inPeriod")} />
          <Tile label={t("summary.transfers")} value={count(s.transfers)} sub={t("summary.inPeriod")} />
        </Group>
      )}

      <Card className="text-muted-foreground flex items-start gap-2 p-3 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("summary.note")}
      </Card>
    </div>
  );
}

/** The date filter and the place filter, shared by every "Less data" view. */
function Filters({
  hidden,
  from,
  to,
  withRange,
  place,
  districts,
  places,
  withPlace,
  extra,
}: {
  hidden: Record<string, string>;
  from: string;
  to: string;
  withRange: boolean;
  place: { district: string; section: string; sector: string; nbhd: string };
  districts: AreaProps["districts"];
  places: { sections: AreaProps["sections"]; sectors: AreaProps["sectors"]; neighbourhoods: AreaProps["neighbourhoods"] };
  withPlace: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <AutoSubmitForm className="flex flex-wrap items-end gap-3 text-sm">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {withRange && (
        <>
          <DateField name="from" value={from} />
          <DateField name="to" value={to} />
        </>
      )}
      {withPlace && (
        <AreaFilter
          key={`${place.district}/${place.section}/${place.sector}/${place.nbhd}`}
          districts={districts}
          sections={places.sections}
          sectors={places.sectors}
          neighbourhoods={places.neighbourhoods}
          initial={place}
        />
      )}
      {extra}
    </AutoSubmitForm>
  );
}

async function DateField({ name, value }: { name: "from" | "to"; value: string }) {
  const t = await getTranslations("reports");
  return (
    <label className="grid gap-1">
      <span className="text-muted-foreground text-xs">{t(name)}</span>
      <Input type="date" name={name} defaultValue={value} className="w-40" />
    </label>
  );
}

/**
 * Reports → "Less data" for one report: the same report and filters as "More data", shown as its totals only
 * (how many lines, and every column the report adds up) instead of the long table.
 */
export async function ReportTotalsView({
  report,
  from,
  to,
  withRange,
  place,
  districts,
  places,
  moreHref,
  exportHref,
}: {
  report: ReportName;
  from: string;
  to: string;
  withRange: boolean;
  place: { district: string; section: string; sector: string; nbhd: string };
  districts: AreaProps["districts"];
  places: { sections: AreaProps["sections"]; sectors: AreaProps["sectors"]; neighbourhoods: AreaProps["neighbourhoods"] };
  moreHref: string;
  /** The download link without its format (null: the person may not export). */
  exportHref: string | null;
}) {
  const t = await getTranslations("reports");
  const format = await getFormatter();
  const locale = await getLocale();
  const usesArea = AREA_REPORTS.includes(report);
  const usesDistrict = DISTRICT_REPORTS.includes(report) || usesArea;
  const rows = await runReport(report, {
    from,
    to,
    district: usesDistrict ? place.district || null : null,
    ...(usesArea ? { section: place.section || null, sector: place.sector || null, neighbourhood: place.nbhd || null } : {}),
  });
  const table = await reportTable(report, rows, locale);
  const value = (v: unknown, kind: string) =>
    v === null || v === undefined || v === ""
      ? "—"
      : kind === "money"
        ? format.number(Number(v), { style: "currency", currency: "USD", maximumFractionDigits: 0 })
        : kind === "pct"
          ? `${format.number(Number(v), { maximumFractionDigits: 1 })} %`
          : format.number(Number(v), { maximumFractionDigits: 2 });
  // Every column the report adds up, from its own totals line (worked out here when the report has none).
  const totals = table.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.sum && (c.kind === "money" || c.kind === "int" || c.kind === "num"))
    .map(({ c, i }) => ({
      label: c.label,
      kind: c.kind,
      total: table.totals?.[i] ?? table.rows.reduce((s, r) => s + Number(r[i] ?? 0), 0),
    }));

  return (
    <div className="space-y-6">
      <Filters
        hidden={{ d: "less", r: report }}
        from={from}
        to={to}
        withRange={withRange}
        place={place}
        districts={districts}
        places={places}
        withPlace={usesDistrict && districts.length > 0}
        extra={
          exportHref && table.rows.length > 0 ? (
            <div className="ms-auto flex flex-wrap gap-1">
              <Button size="sm" variant="outline" asChild>
                <a href={`${exportHref}&format=pdf`}>
                  <FileText aria-hidden />
                  {t("pdf")}
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={`${exportHref}&format=xlsx`}>
                  <FileSpreadsheet aria-hidden />
                  {t("xlsx")}
                </a>
              </Button>
            </div>
          ) : null
        }
      />
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-primary [&_svg]:size-4">
            <Banknote />
          </span>
          {t(`names.${report}`)}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label={t("summary.lines")} value={format.number(table.rows.length)} sub={t("summary.linesSub")} />
          {totals.slice(0, 15).map((x) => (
            <Tile key={x.label} label={x.label} value={value(x.total, x.kind)} tone={x.kind === "money" ? "good" : undefined} />
          ))}
        </div>
        {totals.length === 0 && <p className="text-muted-foreground text-sm">{t("summary.listOnly")}</p>}
      </section>
      <Card className="text-muted-foreground flex flex-wrap items-center gap-2 p-3 text-xs">
        <Info className="size-3.5 shrink-0" aria-hidden />
        {t(`notes.${report}`)}
        <Link href={moreHref} className="text-primary ms-auto font-medium hover:underline">
          {t("summary.openFull")}
        </Link>
      </Card>
    </div>
  );
}
