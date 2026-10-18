import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { CopyCheck } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("duplicatesTitle") };
}

type Row = { id: string; number: string; period: string; total: number; balance: number; status: string; due_date: string; created_at: string; parcel_id: string; fee_type_id: string; parcel: { pun: string | null } | null; fee_type: { name_so: string; name_en: string } | null };

/**
 * Accounts Receivable → Delete duplicate invoices. The database already refuses two bills for the
 * same parcel, fee and period; this finds open bills that look alike anyway (same parcel, fee and
 * amount within 60 days) so a cashier doesn't collect twice. Nothing is deleted: open the invoice
 * and cancel it with a reason.
 */
export default async function DuplicateInvoicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "invoices.cancel");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, number, period, total, balance, status, due_date, created_at, parcel_id, fee_type_id, parcel:parcels(pun), fee_type:fee_types(name_so, name_en)")
    .in("status", ["issued", "partially_paid"])
    .order("created_at")
    .limit(5000);
  const rows = (data ?? []) as unknown as Row[];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.parcel_id}|${r.fee_type_id}|${Number(r.total).toFixed(2)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1 && Math.abs(Date.parse(g.at(-1)!.created_at) - Date.parse(g[0]!.created_at)) <= 60 * 864e5);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("duplicatesTitle")} description={t("duplicatesSubtitle")} />
      <Card className="overflow-hidden">
        {dupes.length === 0 ? (
          <EmptyState icon={<CopyCheck />} title={t("noDuplicates")} description={t("noDuplicatesBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead>{t("invoice")}</TableHead>
                <TableHead>{t("feeType")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dupes.flatMap((g) =>
                g.map((r, i) => (
                  <TableRow key={r.id} className={i === 0 ? "border-t-2" : ""}>
                    <TableCell>{i === 0 && <Mono>{r.parcel?.pun ?? "—"}</Mono>}</TableCell>
                    <TableCell>
                      <Link href={`/invoices/${r.id}`} className="hover:text-primary">
                        <Mono>{r.number}</Mono>
                      </Link>
                      <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(r.created_at), { dateStyle: "medium" })}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.fee_type ? (lang === "so" ? r.fee_type.name_so : r.fee_type.name_en) : "—"} {r.period}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(r.total)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={r.status as "issued"} dueDate={r.due_date} />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
