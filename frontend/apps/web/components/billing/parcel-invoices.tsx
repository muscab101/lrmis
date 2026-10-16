import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listInvoices, recurringFeeTypes } from "@/lib/server/billing";
import { NewFeeInvoiceButton } from "./invoice-actions";
import { InvoiceStatusBadge } from "./status";

/** Invoices of one parcel (server component for the parcel page). */
export async function ParcelInvoices({ parcelId, canCreate }: { parcelId: string; canCreate: boolean }) {
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const [{ rows }, fees] = await Promise.all([listInvoices({ filter: "any", q: "", parcelId }), canCreate ? recurringFeeTypes() : []]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const owed = rows.filter((r) => r.status === "issued" || r.status === "partially_paid").reduce((s, r) => s + Number(r.balance), 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{t("invoicesTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("parcelOwed", { amount: usd(owed) })}</p>
        </div>
        {canCreate && <NewFeeInvoiceButton parcelId={parcelId} feeTypes={fees} />}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noInvoicesParcel")}</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {rows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                  <Mono>{i.number}</Mono>
                  <span className="ms-2 text-muted-foreground">
                    {i.fee_type ? (lang === "so" ? i.fee_type.name_so : i.fee_type.name_en) : ""} {i.period}
                  </span>
                </Link>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{usd(i.balance)}</span>
                  <InvoiceStatusBadge status={i.status} dueDate={i.due_date} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
