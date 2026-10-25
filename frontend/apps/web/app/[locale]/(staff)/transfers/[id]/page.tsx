import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelInvoices } from "@/components/billing/parcel-invoices";
import { ParcelCertificate } from "@/components/documents/parcel-certificate";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { TransferActions } from "@/components/legal/transfer-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getTransfer } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";
import { listPropertyTypes, propertyTypeName } from "@/lib/server/property-types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tr = await getTransfer(id);
  return { title: tr?.number ?? "404" };
}

export default async function TransferPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "transfers.view");
  const t = await getTranslations("legal");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const tr = await getTransfer(id);
  if (!tr) notFound();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const tp = await getTranslations("parcels");
  const ts = await getTranslations("stage");
  const lang = await getLocale();
  // The land being transferred, with its invoices and certificate.
  const [land, propertyTypes] = await Promise.all([tr.parcel ? getParcel(tr.parcel.id) : null, listPropertyTypes()]);
  const num = (n: number | null, unit: string) => (n != null ? `${format.number(Number(n), { maximumFractionDigits: 1 })} ${unit}` : "—");
  const landFacts: [string, React.ReactNode][] = land
    ? [
        [tp("account"), <Mono key="a">{land.account_no ?? "—"}</Mono>],
        [tp("area"), num(land.area_m2, "m²")],
        [ta("propertyType"), propertyTypeName(propertyTypes, land.property_type, lang) ?? "—"],
        [ts("landUse"), ts(`landUses.${land.land_use}`)],
        [tp("place"), [land.district && (lang === "so" ? land.district.name_so : land.district.name_en), land.neighbourhood && (lang === "so" ? land.neighbourhood.name_so : land.neighbourhood.name_en)].filter(Boolean).join(" · ") || "—"],
        [ta("plotNo"), land.plot_no ?? "—"],
        [tp("houseNo"), land.house_no ?? "—"],
        ...(land.flat_no ? [[ta("flatNo"), land.flat_no] as [string, string]] : []),
        [ta("govtReceiptNo"), land.govt_receipt_no ?? "—"],
        [tp("registeredOn"), land.registered_at ? format.dateTime(new Date(land.registered_at), { dateStyle: "medium" }) : "—"],
      ]
    : [];
  const dutyDue = tr.duty_invoice && Number(tr.duty_invoice.balance) > 0;

  const Owners = ({ list }: { list: typeof tr.from_owners }) =>
    list.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t("none")}</p>
    ) : (
      <ul className="divide-y text-sm">
        {list.map((o) => (
          <li key={o.party_id} className="flex justify-between gap-2 py-2">
            <Link href={`/owners/${o.party_id}`} className="hover:text-primary">
              {o.full_name}
            </Link>
            <span className="text-xs text-muted-foreground">
              {ta(`roles.${o.role}`)}
              {o.share_pct != null && ` · ${o.share_pct}%`}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t("transfersTitle")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{tr.number}</Mono>
            <span className="text-base font-normal text-muted-foreground">{t(`status.${tr.status}`)}</span>
          </span>
        }
      >
        <TransferActions id={tr.id} status={tr.status} mine={tr.created_by === viewer.user.id} can={{ create: viewer.can("transfers.create"), approve: viewer.can("transfers.approve") }} />
      </PageHeader>
      {tr.status === "submitted" && dutyDue && <Alert tone="warning" title={t("dutyDueTitle")} className="mb-5">
          {t("dutyDueBody")}
        </Alert>}
      {tr.status === "submitted" && tr.created_by === viewer.user.id && <Alert tone="info" title={t("needsSecond")} className="mb-5" />}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardContent className="pt-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("parcel")}</dt>
              <dd>
                {tr.parcel ? (
                  <Link href={`/parcels/${tr.parcel.id}`} className="underline">
                    <Mono>{tr.parcel.pun}</Mono>
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-muted-foreground">{t("kind")}</dt>
              <dd>{t(`transferKinds.${tr.kind}`)}</dd>
              <dt className="text-muted-foreground">{t("declaredValue")}</dt>
              <dd>{tr.declared_value != null ? usd(tr.declared_value) : "—"}</dd>
              <dt className="text-muted-foreground">{t("duty")}</dt>
              <dd>
                {tr.duty_invoice ? (
                  <Link href={`/invoices/${tr.duty_invoice.id}`} className="underline">
                    <Mono>{tr.duty_invoice.number}</Mono> · {usd(tr.duty_invoice.total)} · {dutyDue ? t("dutyUnpaid") : t("dutyPaid")}
                  </Link>
                ) : (
                  t("dutyOnSubmit")
                )}
              </dd>
              <dt className="text-muted-foreground">{t("created")}</dt>
              <dd>{format.dateTime(new Date(tr.created_at), { dateStyle: "medium", timeStyle: "short" })}</dd>
              {tr.note && (
                <>
                  <dt className="text-muted-foreground">{t("note")}</dt>
                  <dd>{tr.note}</dd>
                </>
              )}
              {tr.decision_note && (
                <>
                  <dt className="text-muted-foreground">{t("decisionNote")}</dt>
                  <dd>{tr.decision_note}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("from")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Owners list={tr.from_owners} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("to")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Owners list={tr.to_owners} />
          </CardContent>
        </Card>

        {land && (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{t("landTitle")}</CardTitle>
                <span className="flex items-center gap-2">
                  <ParcelStatusBadge status={land.status} />
                  <Link href={`/parcels/${land.id}`} className="text-primary text-sm hover:underline">
                    {t("openParcel")}
                  </Link>
                </span>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                  {landFacts.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <GeometryPreview geometry={land.geom} className="h-72 md:h-full" />
            {viewer.can("certificates.view") && land.pun && (
              <div className="md:col-span-2">
                <ParcelCertificate parcelId={land.id} pun={land.pun} canIssue={viewer.can("certificates.approve")} />
              </div>
            )}
            {viewer.can("invoices.view") && (
              <div className="md:col-span-2">
                <ParcelInvoices parcelId={land.id} canCreate={viewer.can("invoices.create")} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
