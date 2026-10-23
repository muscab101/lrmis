import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Banknote, CreditCard, HandCoins } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { CollectHouse } from "@/lib/server/collect";

/**
 * Cashier → To collect: each registered house in the district that still owes, with its unpaid bills.
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
        <ul className="divide-y">
          {houses.map((h) => (
            <li key={h.parcel_id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/parcels/${h.parcel_id}`} className="hover:text-primary">
                    <Mono className="font-medium">{h.pun}</Mono>
                  </Link>
                  <span className="text-sm">
                    {[h.house_no && t("house", { no: h.house_no }), lang === "so" ? h.neighbourhood_so : h.neighbourhood_en, lang === "so" ? h.district_so : h.district_en]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="text-muted-foreground text-sm">{h.owners ?? "—"}</div>
              </div>
              <div className="text-end text-lg font-semibold tabular-nums sm:row-span-2">{usd(h.due)}</div>
              <ul className="space-y-1.5 sm:col-span-1">
                {h.bills.map((b) => (
                  <li key={b.invoice_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <span className="min-w-32">{lang === "so" ? b.fee_name_so : b.fee_name_en}</span>
                    <Mono className="text-muted-foreground text-xs">{b.invoice_number}</Mono>
                    <span className="tabular-nums">{usd(b.balance)}</span>
                    <span className="ms-auto flex gap-1.5">
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
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
