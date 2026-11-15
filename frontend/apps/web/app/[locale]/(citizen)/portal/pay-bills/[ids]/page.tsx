import { Card, CardContent } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PayForm } from "@/app/[locale]/(public)/pay/[token]/pay-form";
import { Link } from "@/i18n/navigation";
import { bankAccount } from "@/lib/server/bank-account";
import { log } from "@/lib/server/log";
import { citizenOverview } from "@/lib/server/portal";
import { availableOnlineProviders, confirmReturnedIntent } from "@/lib/server/providers";

const UUID = /^[0-9a-f-]{36}$/i;

/** Pay several of the citizen's bills in one go (for example the yearly tax and the registration bills). */
export default async function PayBillsPage({ params, searchParams }: { params: Promise<{ locale: string; ids: string }>; searchParams: Promise<{ intent?: string }> }) {
  const { locale, ids } = await params;
  const { intent } = await searchParams;
  // Back from Stripe Checkout: record the payment now if it went through (the webhook may not reach us).
  if (intent) await confirmReturnedIntent(intent).catch((err) => log("warn", "pay.confirm_return_failed", { intent, error: String(err) }));
  setRequestLocale(locale);
  const t = await getTranslations("pay");
  const tb = await getTranslations("portalBills");
  const format = await getFormatter();
  const lang = await getLocale();
  const wanted = new Set(decodeURIComponent(ids).split(",").filter((x) => UUID.test(x)).slice(0, 20));
  const me = await citizenOverview();
  // Only the citizen's own bills, on land that can pay; paid ones drop out.
  const all = me.parcels.flatMap((p) => (p.demolished ? [] : p.invoices.filter((i) => wanted.has(i.id)).map((i) => ({ ...i, pun: p.pun }))));
  const bills = all.filter((b) => Number(b.balance) > 0);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const total = bills.reduce((s, b) => s + Number(b.balance), 0);
  // One bank transfer per property (its PUN is the reference, else the bill number).
  const byRef = new Map<string, number>();
  for (const b of bills) {
    const ref = b.pun ?? b.number;
    byRef.set(ref, (byRef.get(ref) ?? 0) + Number(b.balance));
  }
  const providers = await availableOnlineProviders();
  const validIntent = intent && UUID.test(intent) ? intent : null;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={<Link href="/portal/bills">{tb("title")}</Link>} title={t("titleMany", { count: bills.length || all.length })} />
      {all.length === 0 ? (
        <Alert tone="warning" title={t("notFound")}>
          {t("notFoundBody")}
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <ul className="divide-y text-sm">
              {all.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {lang === "so" ? b.fee_so : b.fee_en} {b.period}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      <Mono>{b.number}</Mono>
                      {b.pun && (
                        <>
                          {" · "}
                          <Mono>{b.pun}</Mono>
                        </>
                      )}
                    </span>
                  </span>
                  <span className={`tabular-nums ${Number(b.balance) > 0 ? "" : "text-status-approved"}`}>{Number(b.balance) > 0 ? usd(b.balance) : t("paidShort")}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-muted-foreground text-sm">{t("totalToPay")}</span>
              <span className="text-3xl font-semibold tabular-nums">{usd(total)}</span>
            </div>
            {bills.length === 0 && !validIntent ? (
              <Alert tone="success" title={t("paidInFull")} />
            ) : (
              <PayForm
                invoiceIds={bills.map((b) => b.id)}
                providers={providers}
                initialIntent={validIntent}
                transfers={[...byRef].map(([reference, amount]) => ({ reference, amount: usd(amount) }))}
                bank={await bankAccount()}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
