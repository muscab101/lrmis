import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { AlertTriangle, BadgeCheck, Eye, Home, MapPin, Phone, Receipt, Wallet } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { fullHouseNo } from "@/lib/house-no";
import { citizenMe, citizenOverview } from "@/lib/server/portal";

export default async function PortalHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const ts = await getTranslations("stage");
  const tpay = await getTranslations("payments");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();
  const who = await citizenMe();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  // Demolished land and land not registered yet (partial) are paid at the district office, not online.
  const payable = (p: (typeof me.parcels)[number]) => !p.demolished && !p.partial;
  const owed = me.parcels.filter(payable).reduce((s, p) => s + Number(p.balance), 0);
  const overdue = me.parcels.filter(payable).reduce((s, p) => s + Number(p.overdue), 0);
  const paidTotal = me.payments.reduce((s, p) => s + Number(p.amount), 0);
  const name = (n: { name_so: string; name_en: string } | null) => (n ? (lang === "so" ? n.name_so : n.name_en) : "");
  const initials = (who?.full_name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <div className="space-y-6">
      {/* The citizen and their totals at a glance. */}
      <Card className="overflow-hidden">
        <div className="from-primary/15 via-primary/5 bg-gradient-to-br to-transparent p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-primary text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold" aria-hidden>
              {initials || <Home className="size-6" />}
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm">{t("welcomeBack")}</p>
              <h1 className="truncate text-2xl font-semibold">{who?.full_name ?? t("myProperties")}</h1>
              {who?.phone && (
                <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1.5 text-sm">
                  <Phone className="size-3.5" aria-hidden />
                  <Mono>{who.phone}</Mono>
                </p>
              )}
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={<Home />} label={t("kpiProperties")} value={String(me.parcels.length)} />
            <Kpi icon={<Wallet />} label={t("toPay")} value={usd(owed)} />
            <Kpi icon={<AlertTriangle />} label={t("kpiOverdue")} value={usd(overdue)} danger={overdue > 0} />
            <Kpi icon={<Receipt />} label={t("kpiPaid")} value={usd(paidTotal)} />
          </dl>
        </div>
      </Card>

      <div>
        {/* My properties */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("myProperties")}</h2>
          {me.parcels.length === 0 ? (
            <Card>
              <EmptyState icon={<Home />} title={t("noParcels")} description={t("noParcelsBody")} />
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {me.parcels.map((p) => {
                const openBills = payable(p) ? p.invoices.filter((i) => Number(i.balance) > 0) : [];
                const titled = p.documents.some((d) => d.type === "certificate" && d.status === "valid");
                return (
                  <li key={p.id}>
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex h-full flex-col gap-3 pt-5">
                        <div className="flex items-start justify-between gap-3">
                          <Link href={`/portal/parcels/${p.id}`} className="hover:text-primary min-w-0">
                            <Mono className="text-base">{p.pun ?? "—"}</Mono>
                            <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-sm">
                              <MapPin className="size-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{[name(p.district), fullHouseNo(name(p.neighbourhood), p.house_no) ?? name(p.neighbourhood)].filter(Boolean).join(" · ")}</span>
                            </span>
                          </Link>
                          {titled && (
                            <span className="bg-status-approved/10 text-status-approved inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                              <BadgeCheck className="size-3.5" aria-hidden />
                              {t("titled")}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span>{ts(`landUses.${p.land_use}`)}</span>
                          {p.area_m2 != null && <span>{format.number(Number(p.area_m2), { maximumFractionDigits: 1 })} m²</span>}
                          {p.share != null && Number(p.share) < 100 && <span>{t("yourShare")}: {format.number(Number(p.share))}%</span>}
                          {p.next_bill && <span>{t("nextBillOn", { date: date(p.next_bill) })}</span>}
                        </div>
                        {(p.demolished || p.partial) && (
                          <p className="bg-status-pending/10 text-status-pending rounded-md px-3 py-2 text-xs">
                            {t(p.demolished ? "demolishedNotice" : "partialNotice", { district: name(p.district) })}
                          </p>
                        )}
                        <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3">
                          <div>
                            <div className="text-muted-foreground text-xs">{t("toPay")}</div>
                            <div className={`text-xl font-semibold tabular-nums ${Number(p.overdue) > 0 ? "text-status-rejected" : ""}`}>{usd(p.balance)}</div>
                            {Number(p.overdue) > 0 && <div className="text-status-rejected text-xs">{t("overdueAmount", { amount: usd(p.overdue) })}</div>}
                          </div>
                          {openBills.length ? (
                            <Button size="sm" asChild>
                              <Link href={`/portal/pay-bills/${openBills.map((i) => i.id).join(",")}`}>{t("payNow")}</Link>
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

      </div>

      {/* Receipts */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" aria-hidden />
            {t("receipts")}
          </CardTitle>
          {me.payments.length > 0 && <span className="text-muted-foreground text-xs">{t("receiptsCount", { count: me.payments.length })}</span>}
        </CardHeader>
        {me.payments.length === 0 ? (
          <CardContent>
            <p className="text-muted-foreground text-sm">{t("noReceipts")}</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tpay("receipt")}</TableHead>
                <TableHead className="hidden sm:table-cell">{tpay("received")}</TableHead>
                <TableHead className="hidden md:table-cell">{tpay("pun")}</TableHead>
                <TableHead className="hidden md:table-cell">{tpay("method")}</TableHead>
                <TableHead className="text-end">{tpay("amount")}</TableHead>
                <TableHead className="text-end">
                  <span className="sr-only">{t("viewReceipt")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {me.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Mono>{p.receipt_no}</Mono>
                    <div className="text-muted-foreground text-xs sm:hidden">{date(p.received_at)}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{date(p.received_at)}</TableCell>
                  <TableCell className="hidden md:table-cell">{p.pun ? <Mono className="text-xs">{p.pun}</Mono> : "—"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{tpay(`methods.${p.method}`)}</TableCell>
                  <TableCell className="text-end tabular-nums">{usd(p.amount)}</TableCell>
                  <TableCell className="text-end">
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/portal/receipts/${p.id}`}>
                        <Eye aria-hidden />
                        <span className="hidden sm:inline">{t("viewReceipt")}</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("messages")}</CardTitle>
          </CardHeader>
          <CardContent>
            {me.messages.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noMessages")}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {me.messages.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <p>{m.body}</p>
                    <span className="text-muted-foreground text-xs">{format.relativeTime(new Date(m.created_at))}</span>
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
          <CardContent className="text-muted-foreground space-y-1 text-sm">
            <p>{t("byPhoneUssd")}</p>
            <p>{t("byPhoneWhatsapp")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, danger }: { icon: ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-background/70 rounded-lg border p-3 backdrop-blur">
      <dt className="text-muted-foreground flex items-center gap-1.5 text-xs [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${danger ? "text-status-rejected" : ""}`}>{value}</dd>
    </div>
  );
}
