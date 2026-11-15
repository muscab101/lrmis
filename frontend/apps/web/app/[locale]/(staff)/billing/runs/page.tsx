import { Card } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { FileStack } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { MissedBills } from "@/components/billing/missed-bills";
import { PlaceFilter } from "@/components/billing/place-filter";
import { RunActions } from "@/components/billing/run-actions";
import { RunStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { billingCounts, listRuns, placeChoices, runBatches } from "@/lib/server/billing";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("runsTitle") };
}

export default async function BillingRunsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ d?: string; s?: string; k?: string; n?: string }> }) {
  const { locale } = await params;
  const { d, s, k, n } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "billing.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const [allRuns, counts, districts, choices] = await Promise.all([listRuns(), billingCounts(), listDistricts(), placeChoices({ d, s, k }, lang)]);
  // With a place chosen: only the runs with land there, and their bills and total for that place alone.
  const place = await Promise.all(
    (d ? allRuns.filter((r) => r.district_ids.includes(d)) : []).map(async (r) => {
      const inPlace = (await runBatches(r.id)).filter(
        (b) => b.district_id === d && (!s || b.section_id === s) && (!k || b.sector_id === k) && (!n || b.neighbourhood_id === n),
      );
      return { id: r.id, found: inPlace.length > 0, bills: inPlace.reduce((sum, b) => sum + b.bills, 0), total: inPlace.reduce((sum, b) => sum + b.total, 0) };
    }),
  );
  const inPlace = new Map(place.map((p) => [p.id, p]));
  const runs = d ? allRuns.filter((r) => inPlace.get(r.id)?.found) : allRuns;
  const placeQuery = new URLSearchParams(Object.entries({ d, s, k, n }).filter((e): e is [string, string] => !!e[1])).toString();
  const dname = new Map(districts.map((d) => [d.id, lang === "so" ? d.name_so : d.name_en]));
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <>
      {/* Runs are made by the system every 1 January; there is no button to start one. */}
      <PageHeader title={t("runsTitle")} description={t("runsSubtitle")}>
        {/* Land the automatic billing missed: check it and make runs for it. */}
        <MissedBills canCreate={viewer.can("billing.create")} />
      </PageHeader>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiChip label={t("kpiWaiting")} value={format.number(counts.runs_waiting)} />
        <KpiChip label={t("kpiOpenInvoices")} value={format.number(counts.invoices_open)} />
        <KpiChip label={t("kpiOutstanding")} value={usd(counts.outstanding)} />
      </div>
      <div className="mb-4 space-y-2">
        <PlaceFilter
          levels={[
            { key: "d", options: choices.d },
            { key: "s", options: choices.s },
            { key: "k", options: choices.k },
            { key: "n", options: choices.n },
          ]}
          query={{ d, s, k, n }}
        />
        {d && <p className="text-muted-foreground text-xs">{t("placeNumbersHint")}</p>}
      </div>
      <Card className="overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState icon={<FileStack />} title={d ? t("noRunsPlace") : t("noRuns")} description={d ? t("noRunsPlaceBody") : t("noRunsBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("number")}</TableHead>
                <TableHead>{t("period")}</TableHead>
                <TableHead>{t("feeType")}</TableHead>
                <TableHead>{t("districts")}</TableHead>
                <TableHead className="text-end">{t("invoices")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/billing/runs/${r.id}${placeQuery ? `?${placeQuery}` : ""}`} className="hover:text-primary">
                      <Mono>{r.number}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.period}</TableCell>
                  <TableCell className="text-sm">{r.fee_type ? (lang === "so" ? r.fee_type.name_so : r.fee_type.name_en) : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{r.district_ids.map((d) => dname.get(d) ?? "?").join(", ")}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{inPlace.get(r.id)?.bills ?? (r.status === "issued" ? r.invoice_count : (r.preview.count ?? 0))}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(inPlace.get(r.id)?.total ?? (r.status === "issued" ? r.total : (r.preview.total ?? 0)))}</TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <RunActions
                      compact
                      bills={r.status === "issued" ? r.invoice_count : (r.preview.count ?? 0)}
                      id={r.id}
                      status={r.status}
                      isCreator={r.created_by === viewer.user.id}
                      can={{ create: viewer.can("billing.create"), approve: viewer.can("billing.approve"), cancel: viewer.can("billing.cancel") }}
                    />
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
