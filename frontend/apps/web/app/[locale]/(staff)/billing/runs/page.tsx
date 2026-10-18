import { Card } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { FileStack } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { NewRunButton } from "@/components/billing/new-run-button";
import { RunStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { billingCounts, listRuns, recurringFeeTypes } from "@/lib/server/billing";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("runsTitle") };
}

export default async function BillingRunsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "billing.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const [runs, counts, districts, fees] = await Promise.all([listRuns(), billingCounts(), listDistricts(), recurringFeeTypes()]);
  const dname = new Map(districts.map((d) => [d.id, lang === "so" ? d.name_so : d.name_en]));
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("runsTitle")} description={t("runsSubtitle")} actions={viewer.can("billing.create") && <NewRunButton districts={districts} feeTypes={fees} />} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiChip label={t("kpiWaiting")} value={format.number(counts.runs_waiting)} />
        <KpiChip label={t("kpiOpenInvoices")} value={format.number(counts.invoices_open)} />
        <KpiChip label={t("kpiOutstanding")} value={usd(counts.outstanding)} />
      </div>
      <Card className="overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState icon={<FileStack />} title={t("noRuns")} description={t("noRunsBody")} />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/billing/runs/${r.id}`} className="hover:text-primary">
                      <Mono>{r.number}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.period}</TableCell>
                  <TableCell className="text-sm">{r.fee_type ? (lang === "so" ? r.fee_type.name_so : r.fee_type.name_en) : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{r.district_ids.map((d) => dname.get(d) ?? "?").join(", ")}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{r.status === "issued" ? r.invoice_count : (r.preview.count ?? 0)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(r.status === "issued" ? r.total : (r.preview.total ?? 0))}</TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
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
