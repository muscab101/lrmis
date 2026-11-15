import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { BadgeCheck, CalendarClock, Eye } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { Link } from "@/i18n/navigation";
import { fullHouseNo } from "@/lib/house-no";
import { citizenOverview } from "@/lib/server/portal";

export default async function CitizenParcelPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const ts = await getTranslations("stage");
  const tpay = await getTranslations("payments");
  const format = await getFormatter();
  const lang = await getLocale();
  const me = await citizenOverview();
  const p = me.parcels.find((x) => x.id === id);
  if (!p) notFound();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const name = (n: { name_so: string; name_en: string } | null) => (n ? (lang === "so" ? n.name_so : n.name_en) : "");
  const houseNo = fullHouseNo(name(p.neighbourhood), p.house_no);
  const payments = p.pun ? me.payments.filter((x) => x.pun === p.pun) : [];
  // Demolished land waits for the district office; partial land can pay (it registers by itself once paid).
  const payable = !p.demolished;
  const open = payable ? p.invoices.filter((i) => Number(i.balance) > 0) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/portal">{t("myProperties")}</Link>}
        title={<Mono>{p.pun ?? "—"}</Mono>}
        description={[name(p.district), houseNo ?? name(p.neighbourhood)].filter(Boolean).join(" · ")}
      >
        {open.length > 0 && (
          <Button asChild>
            <Link href={`/portal/pay-bills/${open.map((i) => i.id).join(",")}`}>{t("payAllAmount", { amount: usd(p.balance) })}</Link>
          </Button>
        )}
      </PageHeader>
      {(p.demolished || p.partial) && (
        <Alert tone="warning" title={t(p.demolished ? "demolishedTitle" : "partialTitle")} className="mb-5">
          {t(p.demolished ? "demolishedNotice" : "partialNotice", { district: name(p.district) })}
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{ts("landUse")}</dt>
              <dd>{ts(`landUses.${p.land_use}`)}</dd>
              <dt className="text-muted-foreground">{t("houseNo")}</dt>
              <dd>{houseNo ? <Mono>{houseNo}</Mono> : "—"}</dd>
              <dt className="text-muted-foreground">{t("area")}</dt>
              <dd>{p.area_m2 != null ? `${format.number(Number(p.area_m2), { maximumFractionDigits: 1 })} m²` : "—"}</dd>
              <dt className="text-muted-foreground">{t("yourShare")}</dt>
              <dd>{p.share != null ? `${p.share} %` : "—"}</dd>
              <dt className="text-muted-foreground">{t("toPay")}</dt>
              <dd className={`font-medium tabular-nums ${Number(p.overdue) > 0 ? "text-status-rejected" : ""}`}>
                {usd(p.balance)}
                {Number(p.overdue) > 0 && <span className="block text-xs font-normal">{t("overdueAmount", { amount: usd(p.overdue) })}</span>}
              </dd>
              {p.next_bill && (
                <>
                  <dt className="text-muted-foreground">{t("nextBill")}</dt>
                  <dd className="inline-flex items-center gap-1.5">
                    <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
                    {date(p.next_bill)}
                  </dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
        {p.geom && <GeometryPreview geometry={p.geom} className="h-64" pin />}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("bills")}</CardTitle>
          </CardHeader>
          <CardContent>
            {p.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noBills")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {p.invoices.map((i) => {
                  const late = Number(i.balance) > 0 && i.due_date < today;
                  return (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span>
                        <Mono>{i.number}</Mono> · {lang === "so" ? i.fee_so : i.fee_en} {i.period}
                        <span className={`block text-xs ${late ? "text-status-rejected" : "text-muted-foreground"}`}>{t("dueOn", { date: date(i.due_date) })}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-end tabular-nums">
                          {usd(i.balance)}
                          {Number(i.balance) < Number(i.total) && <span className="block text-xs text-muted-foreground">{t("ofTotal", { total: usd(i.total) })}</span>}
                        </span>
                        {Number(i.balance) > 0 && !payable ? (
                          <span className="text-xs text-muted-foreground">{t("payAfterRegistered")}</span>
                        ) : Number(i.balance) > 0 ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/portal/pay-bills/${i.id}`}>{t("payNow")}</Link>
                          </Button>
                        ) : (
                          <span className="text-xs font-medium text-status-paid">{t("paid")}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("documents")}</CardTitle>
          </CardHeader>
          <CardContent>
            {p.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {p.documents.map((d) => {
                  const valid = d.status === "valid";
                  return (
                    <li key={d.id} className="flex items-start justify-between gap-2 py-2">
                      <span>
                        <span className="inline-flex items-center gap-1.5">
                          {valid && <BadgeCheck className="text-status-approved size-3.5" aria-hidden />}
                          {t(`docTypes.${d.type}`)} <Mono>{d.serial}</Mono>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("issuedOn", { date: date(d.issued_at) })}
                          {d.expires_at && ` · ${valid ? t("validUntil", { date: date(d.expires_at) }) : t(`docStatus.${d.status === "expired" ? "expired" : "other"}`)}`}
                          {!d.expires_at && !valid && ` · ${t(`docStatus.${d.status === "expired" ? "expired" : "other"}`)}`}
                        </span>
                      </span>
                      <Link href={`/verify/${d.verify_code}`} className="text-xs text-primary hover:underline">
                        {t("verifyLink")}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("receipts")}</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noReceipts")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {payments.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <Mono>{x.receipt_no}</Mono>
                      <span className="block text-xs text-muted-foreground">
                        {date(x.received_at)} · {tpay(`methods.${x.method}`)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{usd(x.amount)}</span>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/portal/receipts/${x.id}`} aria-label={t("viewReceipt")}>
                          <Eye aria-hidden />
                        </Link>
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
