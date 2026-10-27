import { StatusBadge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Lock, MapPinned } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelRowActions } from "@/components/parcels/parcel-row-actions";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { PARCEL_TABS, parcelStageCounts, REGISTERED_SPLITS, searchParcels } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("parcels");
  return { title: t("title") };
}

export default async function ParcelsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  const t = await getTranslations("parcels");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 80);
  // Registered land shows only for roles allowed to see it (Admin → Roles: "See registered land").
  const seesRegistered = viewer.can("parcels.registered");
  const tabs = PARCEL_TABS.filter((k) => k === "draft" || seesRegistered);
  const stage: (typeof PARCEL_TABS)[number] = (tabs as readonly string[]).includes(sp.stage ?? "") ? (sp.stage as (typeof PARCEL_TABS)[number]) : "draft";
  const nbhdId = /^[0-9a-f-]{36}$/i.test(sp.nbhd ?? "") ? sp.nbhd! : null;
  // Inside Registered: all, paid or not paid.
  const split: (typeof REGISTERED_SPLITS)[number] = stage === "registered" && (REGISTERED_SPLITS as readonly string[]).includes(sp.pay ?? "") ? (sp.pay as (typeof REGISTERED_SPLITS)[number]) : "all";
  const [rows, counts] = await Promise.all([searchParcels(q, stage === "registered" && split !== "all" ? split : stage, nbhdId), parcelStageCounts()]);
  const partial = (s: string) => s === "draft" || s === "surveyed" || s === "verified";
  const can = { update: viewer.can("parcels.update"), lock: viewer.can("parcels.lock"), register: viewer.can("parcels.approve") };
  // Delete: partial land with parcels.delete; registered (real) land only with parcels.delete_registered.
  const canDelete = (status: string) => (partial(status) ? viewer.can("parcels.delete") : viewer.can("parcels.delete_registered"));
  const showInvoices = viewer.can("invoices.view");
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("title")} description={t(`stageBody_${stage}`)}>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("stages")}>
          {tabs.map((k) => (
            <Link
              key={k}
              href={`/parcels?${new URLSearchParams({ stage: k, ...(q ? { q } : {}), ...(nbhdId ? { nbhd: nbhdId } : {}) })}`}
              aria-current={stage === k ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${stage === k ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
            >
              {t(`stage_${k}`)} <span className="text-muted-foreground tabular-nums">{counts[k]}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>
      {stage === "registered" && (
        <div className="bg-muted mb-3 flex w-fit gap-0.5 rounded-md p-0.5 text-sm" role="group" aria-label={t("paySplit")}>
          {REGISTERED_SPLITS.map((k) => (
            <Link
              key={k}
              href={`/parcels?${new URLSearchParams({ stage: "registered", ...(k !== "all" ? { pay: k } : {}), ...(q ? { q } : {}), ...(nbhdId ? { nbhd: nbhdId } : {}) })}`}
              aria-current={split === k ? "page" : undefined}
              className={`rounded px-2.5 py-1 whitespace-nowrap ${split === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`split_${k}`)} <span className="text-muted-foreground tabular-nums">{k === "all" ? counts.registered : counts[k]}</span>
            </Link>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-3 border-b p-3" role="search">
          <input type="hidden" name="stage" value={stage} />
          {stage === "registered" && split !== "all" && <input type="hidden" name="pay" value={split} />}
          {nbhdId && <input type="hidden" name="nbhd" value={nbhdId} />}
          {nbhdId && (
            <Link href={`/parcels?stage=${stage}`} className="text-muted-foreground text-xs underline">
              {t("clearNeighbourhood")}
            </Link>
          )}
          <Input name="q" defaultValue={q} placeholder={t("searchPlaceholderMore")} aria-label={t("searchPlaceholderMore")} className="max-w-md" />
          <span className="text-muted-foreground ms-auto text-xs">{t("count", { count: rows.length })}</span>
        </form>
        {rows.length === 0 ? (
          <EmptyState
            icon={<MapPinned />}
            title={q ? t("noMatches") : stage === "draft" ? t("emptyDraftTitle") : t("emptyTitle")}
            description={stage === "draft" ? t("emptyDraftBody") : t("emptyBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden md:table-cell">{t("dateCreated")}</TableHead>
                <TableHead>{t("pun")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("accountNo")}</TableHead>
                {showInvoices && <TableHead className="hidden md:table-cell">{t("invoice")}</TableHead>}
                <TableHead className="hidden xl:table-cell">{t("govtReceipt")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("neighbourhood")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("houseNo")}</TableHead>
                <TableHead>{t("ownerName")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const nbhd = lang === "so" ? p.neighbourhood : (p.neighbourhood_en ?? p.neighbourhood);
                const district = lang === "so" ? p.district : p.district_en;
                return (
                <TableRow key={p.id}>
                  <TableCell className="hidden text-sm whitespace-nowrap tabular-nums md:table-cell">
                    {format.dateTime(new Date(p.created_at), { dateStyle: "medium" })}
                    <div className="text-muted-foreground text-xs">{format.dateTime(new Date(p.created_at), { timeStyle: "short" })}</div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/parcels/${p.id}`} className="hover:text-primary inline-flex items-center gap-1.5">
                      {p.locked_at && <Lock className="text-danger size-3.5 shrink-0" aria-label={t("lockedLabel")} />}
                      <Mono>{p.pun ?? t("noPun")}</Mono>
                    </Link>
                    {/* Narrow screens: the hidden columns, in one line. */}
                    <div className="text-muted-foreground text-xs md:hidden">
                      {[nbhd, p.house_no && `${t("houseNoShort")} ${p.house_no}`].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{p.account_no ? <Mono className="text-xs">{p.account_no}</Mono> : "—"}</TableCell>
                  {showInvoices && (
                    <TableCell className="hidden text-sm md:table-cell">
                      {p.invoice ? <Mono className="text-xs whitespace-nowrap">{p.invoice}</Mono> : "—"}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-sm xl:table-cell">{p.govt_receipt_no ? <Mono className="text-xs">{p.govt_receipt_no}</Mono> : "—"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {nbhd ?? "—"}
                    <div className="text-muted-foreground text-xs">{district}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{p.house_no ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ParcelStatusBadge status={p.status} />
                    {/* Registered land: paid in full (approved, certificate issued) or what it still owes. */}
                    {!partial(p.status) && p.invoice && (
                      <div className="mt-1">
                        <StatusBadge tone={Number(p.balance) > 0 ? "pending" : "approved"}>
                          {Number(p.balance) > 0 ? t("owing", { amount: usd(p.balance) }) : t("paidLabel")}
                        </StatusBadge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <ParcelRowActions parcel={p} can={{ ...can, delete: canDelete(p.status) }} />
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
