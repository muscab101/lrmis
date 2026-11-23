import { Card, CardContent } from "@dhulka/ui/card";
import { EmptyState, KpiChip, PageHeader } from "@dhulka/ui/misc";
import { CreditCard } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { BillsPicker } from "@/components/portal/bills-picker";
import { citizenOverview } from "@/lib/server/portal";

export default async function BillsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portalBills");
  const tp = await getTranslations("portal");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const today = new Date().toISOString().slice(0, 10);
  const bills = me.parcels
    // Demolished land and land not registered yet (partial) are paid at the district office, not online.
    .flatMap((p) => p.invoices.map((i) => ({ ...i, pun: p.pun, parcelId: p.id, payable: !p.demolished && !p.partial, demolished: p.demolished, district: p.district })))
    .sort((a, b) => (Number(b.balance) > 0 ? 1 : 0) - (Number(a.balance) > 0 ? 1 : 0) || a.due_date.localeCompare(b.due_date));
  const open = bills.filter((b) => Number(b.balance) > 0 && b.payable);
  const owed = open.reduce((s, b) => s + Number(b.balance), 0);
  const overdue = open.filter((b) => b.due_date < today).reduce((s, b) => s + Number(b.balance), 0);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <KpiChip label={t("toPay")} value={usd(owed)} tone={owed > 0 ? "warning" : "success"} />
          <KpiChip label={t("overdue")} value={usd(overdue)} tone={overdue > 0 ? "danger" : "default"} />
          <KpiChip label={t("paidThisYear")} value={usd(me.payments.filter((p) => p.received_at.slice(0, 4) === today.slice(0, 4)).reduce((s, p) => s + Number(p.amount), 0))} />
        </div>
      </PageHeader>
      {bills.length === 0 ? (
        <Card>
          <EmptyState icon={<CreditCard />} title={t("none")} description={t("noneBody")} />
        </Card>
      ) : (
        <BillsPicker
          bills={bills.map((b) => {
            const late = Number(b.balance) > 0 && b.due_date < today;
            const due = format.dateTime(new Date(b.due_date), { dateStyle: "medium" });
            return {
              id: b.id,
              title: `${lang === "so" ? b.fee_so : b.fee_en} ${b.period}`,
              number: b.number,
              pun: b.pun,
              parcelId: b.parcelId,
              balance: Number(b.balance),
              total: Number(b.total),
              dueText: Number(b.balance) > 0 ? (late ? t("lateSince", { date: due }) : t("dueOn", { date: due })) : t("paidInFull"),
              late,
              payable: Number(b.balance) > 0 && b.payable,
              notice:
                Number(b.balance) > 0 && !b.payable
                  ? tp(b.demolished ? "demolishedNotice" : "partialNotice", { district: b.district ? (lang === "so" ? b.district.name_so : b.district.name_en) : "" })
                  : null,
            };
          })}
        />
      )}
      <Card className="mt-8">
        <CardContent className="pt-5 text-sm text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">{t("otherWays")}</p>
          <p>{t("otherWaysBody")}</p>
        </CardContent>
      </Card>
    </>
  );
}
