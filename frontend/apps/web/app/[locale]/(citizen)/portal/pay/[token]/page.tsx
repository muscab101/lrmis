import { Card, CardContent } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PayForm } from "@/app/[locale]/(public)/pay/[token]/pay-form";
import { Link } from "@/i18n/navigation";
import { log } from "@/lib/server/log";
import { availableOnlineProviders, confirmReturnedIntent } from "@/lib/server/providers";
import { createClient } from "@/lib/supabase/server";

interface Pub {
  number: string;
  pun: string | null;
  period: string;
  fee: string;
  fee_so: string;
  due_date: string;
  total: number;
  paid: number;
  balance: number;
  partial?: boolean;
  demolished?: boolean;
}

/** Paying a bill without leaving the portal (same flow as the public pay page). */
export default async function PortalPayPage({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ intent?: string }> }) {
  const { locale, token } = await params;
  const { intent } = await searchParams;
  // Back from Stripe Checkout: record the payment now if it went through (the webhook may not reach us).
  if (intent) await confirmReturnedIntent(intent).catch((err) => log("warn", "pay.confirm_return_failed", { intent, error: String(err) }));
  setRequestLocale(locale);
  const t = await getTranslations("pay");
  const tb = await getTranslations("portalBills");
  const format = await getFormatter();
  const lang = await getLocale();
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("invoice_by_token", { p_token: token }) : { data: null };
  const inv = data as Pub | null;
  // Only registered land's bills can be paid (the database refuses the rest too).
  const providers = inv && Number(inv.balance) > 0 && !inv.demolished ? await availableOnlineProviders() : [];
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow={<Link href="/portal/bills">{tb("title")}</Link>} title={t("title")} />
      {!inv ? (
        <Alert tone="warning" title={t("notFound")}>
          {t("notFoundBody")}
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="flex justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {lang === "so" ? inv.fee_so : inv.fee} {inv.period}
                </p>
                <p className="font-mono">{inv.number}</p>
                <p className="text-sm">
                  PUN <Mono>{inv.pun}</Mono>
                </p>
              </div>
              <div className="text-end">
                <p className="text-sm text-muted-foreground">{t("amountDue")}</p>
                <p className="text-3xl font-semibold tabular-nums">{usd(inv.balance)}</p>
                <p className="text-xs text-muted-foreground">{t("due", { date: format.dateTime(new Date(inv.due_date), { dateStyle: "medium" }) })}</p>
              </div>
            </div>
            {Number(inv.balance) <= 0 ? (
              <Alert tone="success" title={t("paidInFull")} />
            ) : inv.demolished ? (
              <Alert tone="warning" title={t("demolishedTitle")}>
                {t("demolishedBody")}
              </Alert>
            ) : (
              <PayForm token={token} providers={providers} initialIntent={intent && /^[0-9a-f-]{36}$/i.test(intent) ? intent : null} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
