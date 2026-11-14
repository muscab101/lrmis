import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { InvoiceActions } from "@/components/billing/invoice-actions";
import { InvoiceStatusBadge } from "@/components/billing/status";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getInvoice } from "@/lib/server/billing";
import { partyPhotoUrl } from "@/lib/server/party-photo";

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
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });
  const fee = inv.fee_type ? (lang === "so" ? inv.fee_type.name_so : inv.fee_type.name_en) : "";
  const place = inv.parcel ? [inv.parcel.neighbourhood && (lang === "so" ? inv.parcel.neighbourhood.name_so : inv.parcel.neighbourhood.name_en), inv.parcel.district && (lang === "so" ? inv.parcel.district.name_so : inv.parcel.district.name_en)].filter(Boolean).join(", ") : "";
  const discountOpen = inv.discount_until && Number(inv.early_discount_pct) > 0 && inv.discount_until >= new Date().toISOString().slice(0, 10) && inv.paid === 0;

  const to = await getTranslations("owners");
  const tp = await getTranslations("parcels");
  const ts = await getTranslations("stage");
  const name = (o: { name_so: string; name_en: string }) => (lang === "so" ? o.name_so : o.name_en);
  const seesOwners = viewer.can("owners.view");
  const owners = inv.parcel?.owners ?? [];
  const photos = await Promise.all(owners.map((o) => partyPhotoUrl(o.party?.id)));
  const num = (n: number) => format.number(Number(n), { maximumFractionDigits: 2 });
  const size = inv.parcel?.area_m2
    ? `${num(inv.parcel.area_m2)} m²${inv.parcel.plot_width_m && inv.parcel.plot_length_m ? ` (${num(inv.parcel.plot_width_m)} × ${num(inv.parcel.plot_length_m)} m)` : ""}`
    : null;
  const demolishedLand = inv.parcel?.building_state === "demolished";
  const partialLand = !demolishedLand && ["draft", "surveyed", "verified"].includes(inv.parcel?.status ?? "");
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
            invoice={{ id: inv.id, paid: Number(inv.paid), status: inv.status, createdBy: inv.created_by }}
            me={viewer.user.id}
            can={{ cancel: viewer.can("invoices.cancel") && !demolishedLand, print: viewer.can("invoices.print") }}
          />
        }
      />
      {inv.status === "cancelled" && (
        <Alert tone="warning" title={t("cancelledInvoice")} className="mb-5">
          {inv.cancel_reason}
        </Alert>
      )}
      {demolishedLand && (
        <Alert tone="warning" title={t("landDemolishedTitle")} className="mb-5">
          {t("landDemolishedHint")}
        </Alert>
      )}
      {partialLand && (
        <Alert tone="info" title={t("landPartialTitle")} className="mb-5">
          {t("landPartialHint")}
        </Alert>
      )}
      {discountOpen && (
        <Alert tone="info" title={t("discountTitle", { pct: Number(inv.early_discount_pct), date: date(inv.discount_until!) })} className="mb-5">
          {t("discountBody")}
        </Alert>
      )}
      {/* The figures first. */}
      <Card className="mb-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x rtl:divide-x-reverse">
          <Figure label={t("total")} value={usd(inv.total)} />
          <Figure label={t("paid")} value={usd(inv.paid)} />
          <Figure label={t("balance")} value={usd(inv.balance)} tone={Number(inv.balance) > 0 ? "text-status-rejected" : "text-status-approved"} />
          <Figure label={t("dueDate")} value={date(inv.due_date)} />
        </dl>
      </Card>
      <div className="grid items-start gap-5 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("billDetails")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {inv.invoice_lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4 py-2.5">
                  <span>
                    {l.description}
                    <span className="bg-muted text-muted-foreground ms-2 rounded-full px-2 py-0.5 text-[11px]">{t(`lineKinds.${l.kind}`)}</span>
                  </span>
                  <span className={`tabular-nums ${Number(l.amount) < 0 ? "text-status-approved" : ""}`}>{usd(l.amount)}</span>
                </li>
              ))}
            </ul>
            <Details
              className="mt-3 border-t pt-4"
              rows={[
                [t("issued"), date(inv.issue_date)],
                [t("feeType"), fee],
                Number(inv.credited) > 0 && [t("credited"), usd(inv.credited)],
                inv.run && [
                  t("run"),
                  <Link key="run" href={`/billing/runs/${inv.run.id}`} className="underline">
                    <Mono>{inv.run.number}</Mono>
                  </Link>,
                ],
                inv.penalty_applied_at && [t("penalty"), date(inv.penalty_applied_at)],
                inv.note && [t("noteLabel"), inv.note],
              ]}
            />
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("ownerDetails", { count: owners.length })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {owners.length === 0 && <p className="text-muted-foreground text-sm">{t("noOwner")}</p>}
              {owners.map((o, n) => {
                const person = o.party!;
                return (
                  <div key={person.id} className={n > 0 ? "border-t pt-5" : undefined}>
                    <div className="mb-3 flex items-center gap-3">
                      <span className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link */}
                        {photos[n] ? <img src={photos[n]!} alt="" className="size-full object-cover" /> : <UserRound className="size-6" aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        {seesOwners ? (
                          <Link href={`/owners/${person.id}`} className="hover:text-primary block truncate font-medium">
                            {person.full_name}
                          </Link>
                        ) : (
                          <p className="truncate font-medium">{person.full_name}</p>
                        )}
                        {person.owner_type && <p className="text-muted-foreground text-xs">{name(person.owner_type)}</p>}
                      </div>
                    </div>
                    <Details
                      rows={[
                        [
                          to("phone"),
                          person.phone && (
                            <a key="tel" href={`tel:${person.phone}`} dir="ltr" className="hover:text-primary font-mono text-xs">
                              {person.phone}
                            </a>
                          ),
                        ],
                        seesOwners && [to("motherName"), person.mother_name],
                        seesOwners && [
                          to("idNumber"),
                          person.id_number && <Mono key="id" className="text-xs">{`${person.id_type ? `${to(`id_${person.id_type}`)} · ` : ""}${person.id_number}`}</Mono>,
                        ],
                        seesOwners && [to("email"), person.email],
                        Number(o.share_pct) > 0 && Number(o.share_pct) < 100 && [t("ownerShare"), `${Number(o.share_pct)}%`],
                      ]}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {inv.parcel && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="text-base">{t("parcelDetails")}</CardTitle>
                <ParcelStatusBadge status={inv.parcel.status} />
              </CardHeader>
              <CardContent>
                <Details
                  rows={[
                    [
                      tp("pun"),
                      <Link key="pun" href={`/parcels/${inv.parcel.id}`} className="hover:text-primary underline">
                        <Mono>{inv.parcel.pun ?? "—"}</Mono>
                      </Link>,
                    ],
                    [tp("accountNo"), inv.parcel.account_no && <Mono key="acct" className="text-xs">{inv.parcel.account_no}</Mono>],
                    [tp("houseNo"), inv.parcel.house_no],
                    [t("propertyType"), inv.property_type_name && name(inv.property_type_name)],
                    [t("size"), size],
                    [ts("landUse"), ts(`landUses.${inv.parcel.land_use}`)],
                    [tp("neighbourhood"), inv.parcel.neighbourhood && name(inv.parcel.neighbourhood)],
                    [t("district"), inv.parcel.district && name(inv.parcel.district)],
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-4">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

/** Label and value pairs; anything empty is left out. */
function Details({ rows, className }: { rows: (false | null | undefined | "" | 0 | [string, React.ReactNode])[]; className?: string }) {
  const shown = rows.filter((r): r is [string, React.ReactNode] => Array.isArray(r) && r[1] !== null && r[1] !== undefined && r[1] !== "");
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm ${className ?? ""}`}>
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
