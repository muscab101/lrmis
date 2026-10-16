import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getParcel } from "@/lib/server/parcels";
import { getParcelValuation, listGrades } from "@/lib/server/valuation";
import { ParcelValuation } from "@/components/valuation/parcel-valuation";
import { ParcelInvoices } from "@/components/billing/parcel-invoices";
import { ParcelCertificate } from "@/components/documents/parcel-certificate";
import { ParcelLegalCard } from "@/components/legal/parcel-legal";
import { parcelLegal } from "@/lib/server/legal";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getParcel(id);
  return { title: p?.pun ?? "404" };
}

export default async function ParcelPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  const t = await getTranslations("parcels");
  const ts = await getTranslations("stage");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const lang = await getLocale();
  const p = await getParcel(id);
  if (!p) notFound();
  const showValuation = viewer.can("valuation.view");
  const [valuation, grades] = showValuation ? await Promise.all([getParcelValuation(p.id), listGrades()]) : [null, []];
  const showLegal = viewer.can("transfers.view") || viewer.can("disputes.view") || viewer.can("permits.view");
  const legal = showLegal && p.pun ? await parcelLegal(p.id) : null;
  const owners = p.parcel_owners.filter((o) => !o.valid_to);
  const num = (n: number | null, unit: string) => (n != null ? `${format.number(Number(n), { maximumFractionDigits: 1 })} ${unit}` : "—");
  const facts: [string, React.ReactNode][] = [
    [t("account"), <Mono key="a">{p.account_no ?? "—"}</Mono>],
    [t("area"), num(p.area_m2, "m²")],
    [t("perimeter"), num(p.perimeter_m, "m")],
    [ts("landUse"), ts(`landUses.${p.land_use}`)],
    [t("place"), [p.district && (lang === "so" ? p.district.name_so : p.district.name_en), p.neighbourhood && (lang === "so" ? p.neighbourhood.name_so : p.neighbourhood.name_en)].filter(Boolean).join(" · ")],
    [ta("plotNo"), p.plot_no ?? "—"],
    [ta("oldDeedNo"), p.deed_no ?? "—"],
    [t("registeredOn"), p.registered_at ? format.dateTime(new Date(p.registered_at), { dateStyle: "medium" }) : "—"],
    [
      t("sourceApplication"),
      p.application ? (
        <Link key="app" href={`/applications/${p.application.id}`} className="underline">
          <Mono>{p.application.number}</Mono>
        </Link>
      ) : (
        "—"
      ),
    ],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t("title")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{p.pun ?? t("noPun")}</Mono>
            <ParcelStatusBadge status={p.status} />
          </span>
        }
      />
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
        <GeometryPreview geometry={p.geom} className="h-72 md:h-full" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("owners")}</CardTitle>
          </CardHeader>
          <CardContent>
            {owners.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOwners")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {owners.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/owners/${o.party.id}`} className="hover:text-primary">
                      {o.party.full_name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {ta(`roles.${o.role}`)}
                      {o.share_pct != null && ` · ${o.share_pct}%`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {p.parcel_history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{t.has(`events.${h.action}`) ? t(`events.${h.action}`) : h.action}</span>
                  <span className="ms-2 text-xs text-muted-foreground">{format.dateTime(new Date(h.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                  {h.note && <p className="text-muted-foreground">{h.note}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        {viewer.can("certificates.view") && p.pun && (
          <div className="md:col-span-2">
            <ParcelCertificate parcelId={p.id} pun={p.pun} canIssue={viewer.can("certificates.approve")} />
          </div>
        )}
        {legal && (
          <div className="md:col-span-2">
            <ParcelLegalCard
              parcel={{ id: p.id, pun: p.pun!, ownership: p.ownership, land_use: p.land_use, status: p.status }}
              data={legal}
              me={viewer.user.id}
              can={{
                transfer: viewer.can("transfers.create"),
                legal: viewer.can("disputes.create"),
                legalApprove: viewer.can("disputes.approve"),
                change: viewer.can("parcels.update"),
                permit: viewer.can("permits.create"),
                lease: viewer.can("parcels.approve"),
              }}
            />
          </div>
        )}
        {viewer.can("invoices.view") && (
          <div className="md:col-span-2">
            <ParcelInvoices parcelId={p.id} canCreate={viewer.can("invoices.create")} />
          </div>
        )}
        {valuation && (
          <div className="md:col-span-2">
            <ParcelValuation
              parcelId={p.id}
              registered={p.status === "registered" || p.status === "disputed"}
              data={valuation}
              grades={grades}
              can={{ edit: viewer.can("valuation.update"), assess: viewer.can("valuation.create") }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
