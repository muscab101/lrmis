import { BrandLockup } from "@dhulka/ui/brand";
import { Card, CardContent } from "@dhulka/ui/card";
import { Alert, Mono } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { availableOnlineProviders } from "@/lib/server/providers";
import { PayForm } from "./pay-form";

export async function generateMetadata() {
  const t = await getTranslations("pay");
  return { title: t("title"), robots: { index: false } };
}

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
  status: string;
}

/** Opened from the QR code on an invoice. Shows only non-personal details. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ intent?: string }> }) {
  const { locale, token } = await params;
  const { intent } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("pay");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const lang = await getLocale();
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{64}$/.test(token) ? await supabase.rpc("invoice_by_token", { p_token: token }) : { data: null };
  const inv = data as Pub | null;
  const providers = inv && Number(inv.balance) > 0 ? await availableOnlineProviders() : [];
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-20 max-w-xl items-center justify-between px-5">
        <Link href="/">
          <BrandLockup name={tc("appShortName")} sub={tc("orgName")} />
        </Link>
        <LocaleSwitch />
      </header>
      <main className="mx-auto max-w-xl px-5 py-8">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        {!inv ? (
          <Alert tone="warning" title={t("notFound")} className="mt-6">
            {t("notFoundBody")}
          </Alert>
        ) : (
          <Card className="mt-6">
            <CardContent className="space-y-4 pt-5">
              <div className="flex justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{lang === "so" ? inv.fee_so : inv.fee} {inv.period}</p>
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
              ) : (
                <>
                  <PayForm token={token} providers={providers} initialIntent={intent && /^[0-9a-f-]{36}$/i.test(intent) ? intent : null} />
                  <Alert tone="info" title={t("howToPay")}>
                    {t("howToPayBody", { pun: inv.pun ?? "" })}
                  </Alert>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
