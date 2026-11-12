import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { HandCoins } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { CollectHouse } from "@/lib/server/collect";
import { fullHouseNo } from "@/lib/house-no";

/**
 * Cashier → To collect: a table of the registered houses in the desk's district that still owe, one line per unpaid bill.
 * "Take payment" opens the cash payment form on that bill. Card payments are for citizens only (online).
 */
export async function ToCollect({ houses, shiftOpen }: { houses: CollectHouse[]; shiftOpen: boolean }) {
  const t = await getTranslations("payments.collect");
  const format = await getFormatter();
  const lang = await getLocale();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const total = houses.reduce((s, h) => s + h.due, 0);
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div>
          <h2 className="font-medium">{t("title")}</h2>
          <p className="text-muted-foreground text-xs">{shiftOpen ? t("subtitle") : t("openShiftFirst")}</p>
        </div>
        <div className="text-sm tabular-nums">{t("summary", { houses: houses.length, amount: usd(total) })}</div>
      </div>
      {houses.length === 0 ? (
        <EmptyState icon={<HandCoins />} title={t("empty")} description={t("emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colPun")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("colHouseNo")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("colAccountNo")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("colOwner")}</TableHead>
              <TableHead>{t("colBill")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("colInvoice")}</TableHead>
              <TableHead className="text-end">{t("colAmount")}</TableHead>
              <TableHead className="text-end">{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {houses.flatMap((h) =>
              h.bills.map((b, i) => (
                <TableRow key={b.invoice_id} className={i > 0 ? "border-t-0" : ""}>
                  {i === 0 && (
                    <>
                      <TableCell rowSpan={h.bills.length} className="align-top">
                        <Link href={`/parcels/${h.parcel_id}`} className="hover:text-primary">
                          <Mono className="font-medium">{h.pun}</Mono>
                        </Link>
                        {h.bills.length > 1 && <div className="text-muted-foreground text-xs tabular-nums">{t("houseTotal", { amount: usd(h.due) })}</div>}
                      </TableCell>
                      <TableCell rowSpan={h.bills.length} className="hidden align-top text-sm font-medium md:table-cell">
                        {fullHouseNo(h.neighbourhood_code, h.house_no) ?? "—"}
                      </TableCell>
                      <TableCell rowSpan={h.bills.length} className="hidden align-top md:table-cell">
                        <Mono className="text-muted-foreground text-xs">{h.account_no ?? "—"}</Mono>
                      </TableCell>
                      <TableCell rowSpan={h.bills.length} className="hidden align-top text-sm sm:table-cell">
                        {h.owners ?? "—"}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-sm">{lang === "so" ? b.fee_name_so : b.fee_name_en}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Mono className="text-muted-foreground text-xs">{b.invoice_number}</Mono>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(b.balance)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {shiftOpen && (
                        <Button size="sm" variant="ghost" className="text-primary" asChild>
                          <Link href={`/cashier?find=${encodeURIComponent(b.invoice_number)}`}>
                            <HandCoins aria-hidden />
                            {t("takePayment")}
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )),
            )}
            <TableRow>
              <TableCell colSpan={7} className="text-end text-sm font-medium tabular-nums">
                {t("summary", { houses: houses.length, amount: usd(total) })}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
