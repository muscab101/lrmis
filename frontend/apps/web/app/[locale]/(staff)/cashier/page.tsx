import { Card } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { OpenShift, TakePayment } from "@/components/payments/cashier-desk";
import { CardPrintBill } from "@/components/payments/card-print-bill";
import { ToCollect } from "@/components/payments/to-collect";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { housesToCollect } from "@/lib/server/collect";
import { listPayments, listPointsOfSale, myOpenShift } from "@/lib/server/payments";
import { getProvider } from "@/lib/server/providers";

export async function generateMetadata() {
  const t = await getTranslations("payments");
  return { title: t("cashierTitle") };
}

export default async function CashierPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ find?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "cashier.view");
  const t = await getTranslations("payments");
  const format = await getFormatter();
  const shift = await myOpenShift();
  const find = ((await searchParams).find ?? "").slice(0, 40);
  // Every registered house in the district that still owes: the cashier collects from this list, only while a shift is open.
  const houses = shift ? await housesToCollect() : [];
  const [points, taken] = await Promise.all([shift ? [] : listPointsOfSale({ id: viewer.user.id, allDistricts: viewer.profile.all_districts, posId: viewer.profile.point_of_sale_id ?? null }), shift ? listPayments({ shiftId: shift.id, status: "any" }) : []]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const cash = taken.filter((p) => p.method === "cash" && p.status !== "reversed").reduce((s, p) => s + Number(p.amount_base), 0);
  return (
    <>
      <PageHeader title={t("cashierTitle")} description={t("cashierSubtitle")} />
      {!shift ? (
        <OpenShift points={points} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          {/* Keyed by ?find so a Cash link from To collect loads that bill even on the same page. */}
          <TakePayment key={find} shift={shift} initialFind={find} />
          <Card className="h-fit overflow-hidden">
            <div className="flex items-center justify-between border-b p-4 text-sm">
              <span className="font-medium">{t("thisShift")}</span>
              <span className="text-muted-foreground">{t("cashInDrawer", { amount: usd(Number(shift.opening_float) + cash) })}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("receipt")}</TableHead>
                  <TableHead>{t("pun")}</TableHead>
                  <TableHead className="text-end">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taken.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/payments/${p.id}`} className="hover:text-primary">
                        <Mono>{p.receipt_no}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Mono>{p.parcel?.pun}</Mono>
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(p.amount_base)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
      {shift && <ToCollect houses={houses} shiftOpen cardEnabled={getProvider("stripe")?.configured() ?? false} />}
      <CardPrintBill />
    </>
  );
}
