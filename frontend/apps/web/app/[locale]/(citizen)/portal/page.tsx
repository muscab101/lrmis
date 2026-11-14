import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Home } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { citizenOverview } from "@/lib/server/portal";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const ts = await getTranslations("stage");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  // Demolished land waits for the district office; partial land can pay (it registers by itself once paid).
  const payable = (p: (typeof me.parcels)[number]) => !p.demolished;
  const owed = me.parcels.filter(payable).reduce((s, p) => s + Number(p.balance), 0);
  const name = (n: { name_so: string; name_en: string } | null) => (n ? (lang === "so" ? n.name_so : n.name_en) : "");

  return (
    <>
      <PageHeader
        title={t("myProperties")}
        description={me.parcels.length ? t("summary", { count: me.parcels.length, owed: usd(owed) }) : t("myPropertiesBody")}
      />

      <section className="mb-8">
        {me.parcels.length === 0 ? (
          <Card>
            <EmptyState icon={<Home />} title={t("noParcels")} description={t("noParcelsBody")} />
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {me.parcels.map((p) => {
              const next = payable(p) ? p.invoices.find((i) => Number(i.balance) > 0 && i.token) : undefined;
              return (
                <li key={p.id}>
                  <Card className="h-full">
                    <CardContent className="flex h-full flex-col gap-3 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/portal/parcels/${p.id}`} className="hover:text-primary">
                          <Mono className="text-base">{p.pun ?? "—"}</Mono>
                          <span className="block text-sm text-muted-foreground">
                            {[name(p.district), name(p.neighbourhood)].filter(Boolean).join(" · ")} · {ts(`landUses.${p.land_use}`)}
                          </span>
                        </Link>
                        {p.documents.some((d) => d.type === "certificate") && <span className="rounded-sm bg-status-approved/10 px-1.5 py-0.5 text-xs text-status-approved">{t("titled")}</span>}
                      </div>
                      {!payable(p) && (
                        <p className="bg-status-pending/10 text-status-pending rounded-md px-3 py-2 text-xs">
                          {t(p.demolished ? "demolishedNotice" : "partialNotice", { district: name(p.district) })}
                        </p>
                      )}
                      <div className="mt-auto flex items-end justify-between gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">{t("toPay")}</div>
                          <div className={`text-xl font-semibold tabular-nums ${Number(p.overdue) > 0 ? "text-status-rejected" : ""}`}>{usd(p.balance)}</div>
                          {Number(p.overdue) > 0 && <div className="text-xs text-status-rejected">{t("overdueAmount", { amount: usd(p.overdue) })}</div>}
                        </div>
                        {next ? (
                          <Button size="sm" asChild>
                            <Link href={`/pay/${next.token}`}>{t("payNow")}</Link>
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/portal/parcels/${p.id}`}>{t("details")}</Link>
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
      </section>

      <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("receipts")}</CardTitle>
            </CardHeader>
            <CardContent>
              {me.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noReceipts")}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {me.payments.slice(0, 6).map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 py-2">
                      <span>
                        <Mono>{p.receipt_no}</Mono>
                        <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(p.received_at), { dateStyle: "medium" })}</span>
                      </span>
                      <span className="tabular-nums">{usd(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("messages")}</CardTitle>
            </CardHeader>
            <CardContent>
              {me.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {me.messages.slice(0, 5).map((m) => (
                    <li key={m.id}>
                      <p>{m.body}</p>
                      <span className="text-xs text-muted-foreground">{format.relativeTime(new Date(m.created_at))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("byPhone")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{t("byPhoneUssd")}</p>
              <p>{t("byPhoneWhatsapp")}</p>
            </CardContent>
          </Card>
      </div>
    </>
  );
}
