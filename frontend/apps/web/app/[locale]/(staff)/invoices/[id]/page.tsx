import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getInvoice, listInvoices, listPlans } from "@/lib/server/billing";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getInvoice(id);
  return { title: inv?.number ?? "404" };
}

export default async function InvoicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "invoices.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const inv = await getInvoice(id);
  if (!inv) notFound();
  const [open, plans] = await Promise.all([
    inv.parcel ? listInvoices({ filter: "open", q: "", parcelId: inv.parcel.id }) : null,
    inv.parcel ? listPlans({ status: "any", parcelId: inv.parcel.id }) : [],
  ]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const fee = inv.fee_type ? (lang === "so" ? inv.fee_type.name_so : inv.fee_type.name_en) : "";
  const place = inv.parcel ? [inv.parcel.neighbourhood && (lang === "so" ? inv.parcel.neighbourhood.name_so : inv.parcel.neighbourhood.name_en), inv.parcel.district && (lang === "so" ? inv.parcel.district.name_so : inv.parcel.district.name_en)].filter(Boolean).join(", ") : "";
  const discountOpen = inv.discount_until && Number(inv.early_discount_pct) > 0 && inv.discount_until >= new Date().toISOString().slice(0, 10) && inv.paid === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={`${fee} · ${inv.period}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{inv.number}</Mono>
            <InvoiceStatusBadge status={inv.status} dueDate={inv.due_date} />
          </span>
        }
        description={
          <>
            {inv.parcel && (
              <Link href={`/parcels/${inv.parcel.id}`} className="underline">
                <Mono>{inv.parcel.pun}</Mono>
              </Link>
            )}{" "}
            · {place}
          </>
        }
        actions={
          <InvoiceActions
            invoice={{ id: inv.id, parcelId: inv.parcel?.id ?? "", balance: Number(inv.balance), paid: Number(inv.paid), status: inv.status, createdBy: inv.created_by }}
            me={viewer.user.id}
            can={{ credit: viewer.can("invoices.create"), cancel: viewer.can("invoices.cancel"), plan: viewer.can("billing.update") }}
            openInvoices={(open?.rows ?? []).map((i) => ({ id: i.id, number: i.number, balance: Number(i.balance) }))}
          />
        }
      />
      {inv.status === "cancelled" && (
        <Alert tone="warning" title={t("cancelledInvoice")} className="mb-5">
          {inv.cancel_reason}
        </Alert>
      )}
      {discountOpen && (
        <Alert tone="info" title={t("discountTitle", { pct: Number(inv.early_discount_pct), date: date(inv.discount_until!) })} className="mb-5">
          {t("discountBody")}
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("lines")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {inv.invoice_lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {l.description}
                    <span className="ms-2 text-xs text-muted-foreground">{t(`lineKinds.${l.kind}`)}</span>
                  </span>
                  <span className={`tabular-nums ${Number(l.amount) < 0 ? "text-status-approved" : ""}`}>{usd(l.amount)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t pt-3 text-sm">
              <dt>{t("total")}</dt>
              <dd className="tabular-nums">{usd(inv.total)}</dd>
              <dt>{t("paid")}</dt>
              <dd className="tabular-nums">{usd(inv.paid)}</dd>
              {Number(inv.credited) > 0 && (
                <>
                  <dt>{t("credited")}</dt>
                  <dd className="tabular-nums">{usd(inv.credited)}</dd>
                </>
              )}
              <dt className="font-semibold">{t("balance")}</dt>
              <dd className="font-semibold tabular-nums">{usd(inv.balance)}</dd>
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardContent className="pt-5">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("issued")}</dt>
                <dd>{date(inv.issue_date)}</dd>
                <dt className="text-muted-foreground">{t("dueDate")}</dt>
                <dd>{date(inv.due_date)}</dd>
                <dt className="text-muted-foreground">{t("account")}</dt>
                <dd>
                  <Mono>{inv.parcel?.account_no ?? "—"}</Mono>
                </dd>
                {inv.run && (
                  <>
                    <dt className="text-muted-foreground">{t("run")}</dt>
                    <dd>
                      <Link href={`/billing/runs/${inv.run.id}`} className="underline">
                        <Mono>{inv.run.number}</Mono>
                      </Link>
                    </dd>
                  </>
                )}
                {inv.penalty_applied_at && (
                  <>
                    <dt className="text-muted-foreground">{t("penalty")}</dt>
                    <dd>{date(inv.penalty_applied_at)}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
          {inv.credit_notes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("sections.credit")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {inv.credit_notes.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span>
                        <Mono>{c.number}</Mono> · {c.reason}
                      </span>
                      <span className="text-xs whitespace-nowrap">
                        {usd(c.amount)} · {t(`decision.${c.status}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {plans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("sections.plans")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {plans.map((p) => (
                  <div key={p.id}>
                    <p>
                      <Mono>{p.number}</Mono> · {usd(p.total)} · {t(`planStatus.${p.status}`)}
                    </p>
                    <ol className="mt-1 text-xs text-muted-foreground">
                      {p.payment_plan_installments.map((i) => (
                        <li key={i.seq}>
                          {i.seq}. {date(i.due_date)} — {usd(i.amount)}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
