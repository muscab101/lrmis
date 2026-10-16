import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { CreditCard } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { citizenOverview } from "@/lib/server/portal";

export default async function BillsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portalBills");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const today = new Date().toISOString().slice(0, 10);
  const bills = me.parcels
    .flatMap((p) => p.invoices.map((i) => ({ ...i, pun: p.pun, parcelId: p.id })))
    .sort((a, b) => (Number(b.balance) > 0 ? 1 : 0) - (Number(a.balance) > 0 ? 1 : 0) || a.due_date.localeCompare(b.due_date));
  const open = bills.filter((b) => Number(b.balance) > 0);
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
        <ul className="space-y-3">
          {bills.map((b) => {
            const late = Number(b.balance) > 0 && b.due_date < today;
            return (
              <li key={b.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {lang === "so" ? b.fee_so : b.fee_en} {b.period}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <Mono>{b.number}</Mono> ·{" "}
                        <Link href={`/portal/parcels/${b.parcelId}`} className="hover:text-primary">
                          <Mono>{b.pun ?? "—"}</Mono>
                        </Link>
                      </p>
                      <p className={`text-xs ${late ? "text-status-rejected" : "text-muted-foreground"}`}>
                        {Number(b.balance) > 0 ? (late ? t("lateSince", { date: format.dateTime(new Date(b.due_date), { dateStyle: "medium" }) }) : t("dueOn", { date: format.dateTime(new Date(b.due_date), { dateStyle: "medium" }) })) : t("paidInFull")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-end">
                        <p className="text-xl font-semibold tabular-nums">{usd(b.balance)}</p>
                        {Number(b.balance) < Number(b.total) && <p className="text-xs text-muted-foreground">{t("ofTotal", { total: usd(b.total) })}</p>}
                      </div>
                      {Number(b.balance) > 0 && b.token && (
                        <Button asChild>
                          <Link href={`/portal/pay/${b.token}`}>{t("pay")}</Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
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
