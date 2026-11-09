import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Banknote, CreditCard, HandCoins } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { CollectHouse } from "@/lib/server/collect";
import { fullHouseNo } from "@/lib/house-no";

/**
 * Cashier → To collect: a table of the registered houses in the desk's district that still owe, one line per unpaid bill.
 * Cash opens the payment form on that bill (needs an open shift); Card opens Stripe Checkout in a new tab.
 */
export async function ToCollect({ houses, shiftOpen, cardEnabled }: { houses: CollectHouse[]; shiftOpen: boolean; cardEnabled: boolean }) {
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
              <TableHead className="hidden md:table-cell">{t("colPlace")}</TableHead>
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
                      <TableCell rowSpan={h.bills.length} className="hidden align-top text-sm md:table-cell">
                        {/* The full house number already starts with the neighbourhood (its name is its code). */}
                        {h.house_no ? t("house", { no: fullHouseNo(h.neighbourhood_so, h.house_no)! }) : lang === "so" ? h.neighbourhood_so : h.neighbourhood_en}
                        <div className="text-muted-foreground text-xs">{lang === "so" ? h.district_so : h.district_en}</div>
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
                    <div className="flex justify-end gap-1.5">
                      {shiftOpen && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/cashier?find=${encodeURIComponent(b.invoice_number)}`}>
                            <Banknote aria-hidden />
                            {t("cash")}
                          </Link>
                        </Button>
                      )}
                      {cardEnabled && b.pay_path && (
                        <Button size="sm" asChild>
                          <Link href={b.pay_path} target="_blank">
                            <CreditCard aria-hidden />
                            {t("card")}
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
