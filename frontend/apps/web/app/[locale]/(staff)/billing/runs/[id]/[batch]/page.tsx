import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowLeft, Receipt } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getRun, runBatchBills, runBatches } from "@/lib/server/billing";
import { fullHouseNo } from "@/lib/house-no";

/** One neighbourhood of a billing run: every property in it, its bill (or why it is skipped). */
export default async function RunNeighbourhoodPage({ params }: { params: Promise<{ locale: string; id: string; batch: string }> }) {
  const { locale, id, batch } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "billing.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const run = await getRun(id);
  // A batch is one neighbourhood ("none": land without one).
  const batchId = batch === "none" ? null : /^[0-9a-f-]{36}$/i.test(batch) ? batch : undefined;
  if (!run || batchId === undefined) notFound();
  const [batches, bills] = await Promise.all([runBatches(run.id), runBatchBills(run.id, batchId)]);
  const b = batches.find((x) => x.neighbourhood_id === batchId);
  const nm = (so: string | null, en: string | null) => (lang === "so" ? so : en) ?? so ?? en ?? "—";
  const place = b?.neighbourhood_id
    ? [b.neighbourhood_code, nm(b.neighbourhood_so, b.neighbourhood_en)].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ")
    : t("noNeighbourhood");
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={`${t("runsTitle")} · ${run.number}`}
        title={place}
        description={b ? [nm(b.section_so, b.section_en), nm(b.district_so, b.district_en)].filter((x) => x !== "—").join(", ") : undefined}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/billing/runs/${run.id}`}>
              <ArrowLeft aria-hidden />
              {t("backToRun")}
            </Link>
          </Button>
        }
      >
        {b && (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <KpiChip label={t("invoices")} value={format.number(b.bills)} />
            <KpiChip label={t("total")} value={usd(b.total)} />
            <KpiChip label={t("batchSkipped")} value={format.number(b.skipped)} />
          </div>
        )}
      </PageHeader>
      <Card className="overflow-hidden">
        {bills.length === 0 ? (
          <EmptyState icon={<Receipt />} title={t("noBatchesHere")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("houseNo")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("owner")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead>{run.status === "issued" ? t("invoice") : t("batchState")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((r) => (
                <TableRow key={r.parcel_id}>
                  <TableCell>
                    <Link href={`/parcels/${r.parcel_id}`} className="hover:text-primary">
                      <Mono>{r.pun ?? "—"}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{fullHouseNo(b?.neighbourhood_code ?? null, r.house_no) ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.owner ?? "—"}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{r.amount != null && !r.exception ? usd(r.amount) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.invoice_id ? (
                      <Link href={`/invoices/${r.invoice_id}`} className="hover:text-primary">
                        <Mono>{r.invoice_number}</Mono>
                      </Link>
                    ) : r.exception ? (
                      <span className="text-status-pending">{t(`exceptions.${r.exception}`)}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("willBeBilled")}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
