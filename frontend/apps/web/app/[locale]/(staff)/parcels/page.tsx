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
import { fullHouseNo } from "@/lib/house-no";
import { segClass, segGroupClass, TabCount, tabClass } from "@/components/shell/tabs";

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
  // Inside Registered: all, paid, not paid or demolished.
  const split: (typeof REGISTERED_SPLITS)[number] = stage === "registered" && (REGISTERED_SPLITS as readonly string[]).includes(sp.pay ?? "") ? (sp.pay as (typeof REGISTERED_SPLITS)[number]) : "all";
  const [rows, counts] = await Promise.all([searchParcels(q, stage === "registered" && split !== "all" ? split : stage, nbhdId), parcelStageCounts()]);
  const partial = (s: string) => s === "draft" || s === "surveyed" || s === "verified";
  const can = { update: viewer.can("parcels.update"), lock: viewer.can("parcels.lock"), register: viewer.can("parcels.approve") };
  // Delete: partial land with parcels.delete; registered (real) land only with parcels.delete_registered.
  const canDelete = (status: string) => (partial(status) ? viewer.can("parcels.delete") : viewer.can("parcels.delete_registered"));
  const showInvoices = viewer.can("invoices.view");

  return (
    <>
      <PageHeader title={t("title")} description={t(`stageBody_${stage}`)}>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("stages")}>
          {tabs.map((k) => (
            <Link
              key={k}
              href={`/parcels?${new URLSearchParams({ stage: k, ...(q ? { q } : {}), ...(nbhdId ? { nbhd: nbhdId } : {}) })}`}
              aria-current={stage === k ? "page" : undefined}
              className={tabClass(stage === k)}
            >
              {t(`stage_${k}`)} <TabCount n={counts[k]} />
            </Link>
          ))}
        </nav>
      </PageHeader>
      {stage === "registered" && (
        <div className={`${segGroupClass} mb-3`} role="group" aria-label={t("paySplit")}>
          {REGISTERED_SPLITS.map((k) => (
            <Link
              key={k}
              href={`/parcels?${new URLSearchParams({ stage: "registered", ...(k !== "all" ? { pay: k } : {}), ...(q ? { q } : {}), ...(nbhdId ? { nbhd: nbhdId } : {}) })}`}
              aria-current={split === k ? "page" : undefined}
              className={segClass(split === k)}
            >
              {t(`split_${k}`)} <TabCount n={k === "all" ? counts.registered : counts[k]} />
            </Link>
          ))}
        </div>
      )}
      {split === "demolished" && (
        <p className="text-muted-foreground mb-3 text-sm">
          {t("demolishedHint")}{" "}
          {viewer.can("parcels.demolitions") && (
            <Link href="/demolished" className="text-foreground font-medium underline">
              {t("demolishedOpenArchive")}
            </Link>
          )}
        </p>
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
                <TableHead className="hidden md:table-cell">{t("district")}</TableHead>
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
                // The neighbourhood with the house or flat number (its name is its code), unless the number already starts with it.
                const houseNo = fullHouseNo(p.neighbourhood, p.house_no);
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
                      {[houseNo ?? nbhd, p.building_state === "demolished" && t("demolishedLabel")].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {p.account_no ? <Mono className="whitespace-nowrap">{p.account_no}</Mono> : "—"}
                  </TableCell>
                  {showInvoices && (
                    <TableCell className="hidden text-sm md:table-cell">
                      {p.invoice ? <Mono className="text-xs whitespace-nowrap">{p.invoice}</Mono> : "—"}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-sm md:table-cell">{district ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{houseNo ?? nbhd ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ParcelStatusBadge status={p.status} />
                    {p.building_state === "demolished" && (
                      <div className="mt-1">
                        <StatusBadge tone="draft">{t("demolishedLabel")}</StatusBadge>
                      </div>
                    )}
                    {/* Registered land: paid in full (approved, certificate issued) or what it still owes. Demolished land
                        shows neither: the house is no longer there. */}
                    {!partial(p.status) && p.building_state !== "demolished" && (p.invoice || Number(p.balance) > 0) && (
                      <div className="mt-1">
                        <StatusBadge tone={Number(p.balance) > 0 ? "pending" : "paid"}>
                          {Number(p.balance) > 0 ? t("notPaidLabel") : t("paidLabel")}
                        </StatusBadge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Partial land: View, Update, Delete, and Move to registered once it has an owner; locking is on its own page. Registered land can't be deleted once money was received, and a registered flat goes with its building. */}
                    <ParcelRowActions
                      parcel={p}
                      can={p.building_state === "demolished" ? { update: false, lock: false } : partial(p.status) ? { update: can.update, lock: false, register: can.register && !!p.owners, delete: canDelete(p.status) } : { ...can, delete: !p.parent_id && !p.has_money && canDelete(p.status) }}
                    />
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
