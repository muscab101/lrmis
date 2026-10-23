import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CorrectionsList } from "@/components/collections/corrections-list";
import { EvidencePanel } from "@/components/collections/evidence-panel";
import { PaymentVerifyActions } from "@/components/collections/payment-verify-actions";
import { VerifyStatusBadge } from "@/components/collections/verify-status";
import { PaymentActions } from "@/components/payments/payment-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listCorrections, paymentExtras, paymentVerification } from "@/lib/server/collections";
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
  const [p, x, ver, corrections] = await Promise.all([getPayment(id), paymentExtras(id), paymentVerification(id), listCorrections({ status: "any", paymentId: id })]);
  if (!p || !x || !ver) notFound();
  const canVerify = viewer.can("reconciliation.update") && x.created_by !== viewer.user.id && p.status !== "reversed";
  const canCorrect = p.status !== "reversed" && ((x.created_by === viewer.user.id && viewer.can("payments.create")) || viewer.can("reconciliation.update"));
  const tc = await getTranslations("collections");
  // Against what the payer owed when they paid: an overpayment leaves credit, an underpayment leaves a balance.
  const gap = x.expected_amount === null ? null : Math.round((Number(x.amount_base) - Number(x.expected_amount)) * 100) / 100;
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const facts: [string, React.ReactNode][] = [
    [t("received"), format.dateTime(new Date(p.received_at), { dateStyle: "long", timeStyle: "short" })],
    [t("method"), x.wallet ? `${t("methods.mobile_money")} · ${t.has(`wallets.${x.wallet}`) ? t(`wallets.${x.wallet}`) : x.wallet}` : `${t(`methods.${p.method}`)}${p.provider ? ` · ${p.provider}` : ""}`],
    [t("amount"), p.currency === "USD" ? usd(p.amount) : `${format.number(Number(p.amount))} ${p.currency} @ ${Number(p.fx_rate)} = ${usd(p.amount_base)}`],
    ...(x.expected_amount !== null
      ? ([
          [tc("expected"), usd(x.expected_amount)],
          [
            tc("againstExpected"),
            gap === 0 ? tc("exact") : gap! > 0 ? <span key="g" className="text-status-pending">{tc("overpaid", { amount: usd(gap!) })}</span> : <span key="g" className="text-status-rejected">{tc("underpaid", { amount: usd(-gap!) })}</span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
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
      <Card className="mt-5">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {tc("verification")} <VerifyStatusBadge status={ver.verify_status} />
          </CardTitle>
          <PaymentVerifyActions
            paymentId={p.id}
            status={ver.verify_status}
            current={{ how: x.wallet ?? p.method, reference: p.reference ?? "", payerName: p.payer_name ?? "", payerPhone: p.payer_phone ?? "" }}
            can={{ verify: canVerify, correct: canCorrect }}
            correctionPending={corrections.some((c) => c.status === "pending")}
          />
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {ver.verified_at && (
            <p className="text-muted-foreground">
              {tc(ver.verify_status === "disputed" ? "disputedBy" : "verifiedBy", {
                by: ver.verified_by_name ?? "—",
                at: format.dateTime(new Date(ver.verified_at), { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
          {ver.dispute_reason && <p>{ver.dispute_reason}</p>}
          {!ver.verified_at && <p className="text-muted-foreground">{tc("notChecked")}</p>}
        </CardContent>
        {corrections.length > 0 && (
          <div className="border-t">
            <CorrectionsList rows={corrections} canDecide={viewer.can("payments.approve")} me={viewer.user.id} showReceipt={false} />
          </div>
        )}
      </Card>
      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="text-base">{tc("evidence.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <EvidencePanel
            paymentId={p.id}
            files={x.evidence}
            canAdd={(x.created_by === viewer.user.id && viewer.can("payments.create")) || viewer.can("reconciliation.update") || viewer.can("payments.approve")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
