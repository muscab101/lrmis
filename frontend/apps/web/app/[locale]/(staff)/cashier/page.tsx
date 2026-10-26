import { Card } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { HandoverButton, HandoverCancel } from "@/components/collections/handovers";
import { OpenShift, TakePayment } from "@/components/payments/cashier-desk";
import { CardPrintBill } from "@/components/payments/card-print-bill";
import { ToCollect } from "@/components/payments/to-collect";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { housesToCollect } from "@/lib/server/collect";
import { handoverReceivers, listHandovers, shiftsToHandOver } from "@/lib/server/finance";
import { listPayments, listPointsOfSale, myOpenShift } from "@/lib/server/payments";
import { getProvider } from "@/lib/server/providers";

export async function generateMetadata() {
  const t = await getTranslations("payments");
  return { title: t("cashierTitle") };
}

export default async function CashierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ find?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "cashier.view");
  const t = await getTranslations("payments");
  const tc = await getTranslations("collections");
  const format = await getFormatter();
  const shift = await myOpenShift();
  const find = ((await searchParams).find ?? "").slice(0, 40);
  // Every registered house in the district that still owes: the cashier collects from this list, only while a shift is open.
  const houses = shift ? await housesToCollect() : [];
  const [points, taken] = await Promise.all([
    shift
      ? []
      : listPointsOfSale({
          id: viewer.user.id,
          allDistricts: viewer.profile.all_districts,
          posId: viewer.profile.point_of_sale_id ?? null,
        }),
    shift ? listPayments({ shiftId: shift.id, status: "any" }) : [],
  ]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  // Closed shifts whose counted cash still has to go to someone who confirms it, and handovers waiting for them.
  const [toHandOver, sent] = await Promise.all([
    shiftsToHandOver(viewer.user.id),
    listHandovers({ status: "pending", mine: viewer.user.id }),
  ]);
  const receivers = await Promise.all(toHandOver.map((s) => handoverReceivers(s.id)));
  const waiting = sent.rows.filter((h) => h.from_user === viewer.user.id);
  const cash = taken
    .filter((p) => p.method === "cash" && p.status !== "reversed")
    .reduce((s, p) => s + Number(p.amount_base), 0);
  return (
    <>
      <PageHeader title={t("cashierTitle")} description={t("cashierSubtitle")} />
      {(toHandOver.length > 0 || waiting.length > 0) && (
        <Card className="border-warning/40 mb-5 overflow-hidden">
          <div className="border-b p-4 text-sm">
            <p className="font-medium">{tc("handovers.cardTitle")}</p>
            <p className="text-muted-foreground text-xs">{tc("handovers.cardBody")}</p>
          </div>
          <ul className="divide-y text-sm">
            {toHandOver.map((s, i) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span>
                  <Mono>{s.number}</Mono> ·{" "}
                  {format.dateTime(new Date(s.closed_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  <span className="text-muted-foreground block text-xs">
                    {tc("handovers.countedLine", {
                      counted: usd(s.counted_cash),
                      expected: usd(s.expected_cash),
                      difference: usd(s.difference),
                    })}
                  </span>
                </span>
                <HandoverButton shift={s} receivers={receivers[i] ?? []} />
              </li>
            ))}
            {waiting.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span>
                  <Mono>{h.number}</Mono> · {usd(h.amount)}
                  <span className="text-muted-foreground block text-xs">
                    {tc("handovers.waitingFor", { name: sent.names[h.to_user] ?? "—" })}
                  </span>
                </span>
                <HandoverCancel id={h.id} number={h.number} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!shift ? (
        <OpenShift points={points} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          {/* Keyed by ?find so a Cash link from To collect loads that bill even on the same page. */}
          <TakePayment key={find} shift={shift} initialFind={find} />
          <Card className="h-fit overflow-hidden">
            <div className="flex items-center justify-between border-b p-4 text-sm">
              <span className="font-medium">{t("thisShift")}</span>
              <span className="text-muted-foreground">
                {t("cashInDrawer", { amount: usd(Number(shift.opening_float) + cash) })}
              </span>
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
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(p.amount_base)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
      {shift && (
        <ToCollect
          houses={houses}
          shiftOpen
          cardEnabled={getProvider("stripe")?.configured() ?? false}
        />
      )}
      <CardPrintBill />
    </>
  );
}
