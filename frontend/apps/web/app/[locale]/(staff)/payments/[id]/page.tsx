import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PaymentActions } from "@/components/payments/payment-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getPayment } from "@/lib/server/payments";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPayment(id);
  return { title: p?.receipt_no ?? "404" };
}

export default async function PaymentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "payments.view");
  const t = await getTranslations("payments");
  const format = await getFormatter();
  const p = await getPayment(id);
  if (!p) notFound();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const facts: [string, React.ReactNode][] = [
    [t("received"), format.dateTime(new Date(p.received_at), { dateStyle: "long", timeStyle: "short" })],
    [t("method"), `${t(`methods.${p.method}`)}${p.provider ? ` · ${p.provider}` : ""}`],
    [t("amount"), p.currency === "USD" ? usd(p.amount) : `${format.number(Number(p.amount))} ${p.currency} @ ${Number(p.fx_rate)} = ${usd(p.amount_base)}`],
    [t("pun"), p.parcel ? <Link key="p" href={`/parcels/${p.parcel.id}`} className="underline"><Mono>{p.parcel.pun}</Mono></Link> : "—"],
    [t("payerName"), [p.payer_name, p.payer_phone].filter(Boolean).join(" · ") || "—"],
    [t("reference"), p.reference ?? p.provider_ref ?? "—"],
    [t("pointOfSale"), p.pos ? `${p.pos.code} · ${p.pos.name}` : "—"],
    [t("shift"), p.shift?.number ?? "—"],
  ];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t("receipt")}
        title={<Mono>{p.receipt_no}</Mono>}
        description={t(`status.${p.status}`)}
        actions={<PaymentActions id={p.id} status={p.status} unallocated={Number(p.unallocated)} can={{ reverse: viewer.can("payments.refund"), applyCredit: viewer.can("payments.create") }} />}
      />
      {p.status === "reversed" && (
        <Alert tone="warning" title={t("reversedTitle")} className="mb-5">
          {p.reversal_reason}
        </Alert>
      )}
      {p.status === "unmatched" && <Alert tone="info" title={t("unmatchedTitle")} className="mb-5">{t("unmatchedBody")}</Alert>}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("allocations")}</CardTitle>
          </CardHeader>
          <CardContent>
            {p.payment_allocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noAllocations")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {p.payment_allocations.map((a) => (
                  <li key={a.id} className="flex justify-between py-2">
                    <Link href={`/invoices/${a.invoice?.id}`} className="hover:text-primary">
                      <Mono>{a.invoice?.number}</Mono> <span className="text-muted-foreground">{a.invoice?.period}</span>
                    </Link>
                    <span className="tabular-nums">
                      {usd(a.amount)}
                      {Number(a.discount) > 0 && <span className="ms-2 text-xs text-status-approved">−{usd(a.discount)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {Number(p.unallocated) > 0 && <p className="mt-3 text-sm">{t("creditLeft", { amount: usd(p.unallocated) })}</p>}
            {p.payment_reversals.length > 0 && (
              <ul className="mt-4 space-y-1 border-t pt-3 text-sm">
                {p.payment_reversals.map((r) => (
                  <li key={r.id}>
                    {t("reversalLine", { status: t(`decision.${r.status}`) })} — {r.reason}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
