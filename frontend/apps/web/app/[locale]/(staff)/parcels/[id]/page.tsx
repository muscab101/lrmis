import { zebraRows } from "@dhulka/ui/table";
import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { ParcelRowActions } from "@/components/parcels/parcel-row-actions";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { SiteCheckButtons } from "@/components/parcels/site-check-buttons";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { getLandUnits, getParcel, getParentLand, parcelsWithMoney } from "@/lib/server/parcels";
import { BuildingTaxEdit } from "@/components/parcels/building-tax-edit";
import { BuildingManagerAreas } from "@/components/parcels/building-manager-areas";
import { buildingExtras } from "@/lib/server/apartments";
import { listDistricts } from "@/lib/server/users";
import { missingFloors } from "@/lib/land-units";
import { openDemolitionOf } from "@/lib/server/demolitions";
import { MarkDemolished } from "@/components/demolitions/mark-demolished";
import { listPropertyTypes, propertyTypeName } from "@/lib/server/property-types";
import { getParcelValuation, listGrades } from "@/lib/server/valuation";
import { ParcelValuation } from "@/components/valuation/parcel-valuation";
import { ParcelInvoices } from "@/components/billing/parcel-invoices";
import { ParcelCertificate } from "@/components/documents/parcel-certificate";
import { TransferHistory } from "@/components/legal/transfer-history";
import { fullHouseNo } from "@/lib/house-no";
import { PartialRebill } from "@/components/parcels/partial-rebill";
import type { BillCheck } from "@/app/[locale]/(staff)/parcels/actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getParcel(id);
  if (!p) return { title: "404" };
  // Partial land has no PUN yet: name it by its house number.
  const t = await getTranslations("parcels");
  return { title: p.pun ?? (p.house_no ? `${t("houseNoShort")} ${fullHouseNo(p.neighbourhood?.code, p.house_no)}` : t("noPun")) };
}

/** The next anniversary of a date, after today (the yearly tax bill day). */
function nextAnniversary(anchor: string) {
  const a = new Date(`${anchor}T00:00:00Z`);
  const today = new Date();
  const d = new Date(a);
  d.setUTCFullYear(Math.max(a.getUTCFullYear() + 1, today.getUTCFullYear()));
  while (d <= today) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export default async function ParcelPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  const t = await getTranslations("parcels");
  const ts = await getTranslations("stage");
  const tl = await getTranslations("legal");
  const ta = await getTranslations("applications");
  const format = await getFormatter();
  const lang = await getLocale();
  const [p, propertyTypes] = await Promise.all([getParcel(id), listPropertyTypes()]);
  if (!p) notFound();
  const partial = p.status === "draft" || p.status === "surveyed" || p.status === "verified";
  // Registered land with bills: paid in full, or what's still owed.
  const owed = await (async () => {
    if (partial || !viewer.can("invoices.view")) return null;
    const supabase = await createClient();
    // A building owes what its units owe, and demolished units' old bills still count.
    const { data: kids } = await supabase.from("parcels").select("id").eq("parent_id", p.id).is("deleted_at", null);
    const ids = [p.id, ...((kids ?? []) as { id: string }[]).map((k) => k.id)];
    const { data } = await supabase.from("invoices").select("balance, status").in("parcel_id", ids).neq("status", "cancelled");
    const rows = (data ?? []) as { balance: number; status: string }[];
    return rows.length ? rows.reduce((s, i) => s + Number(i.balance), 0) : null;
  })();
  const showValuation = viewer.can("valuation.view");
  const [valuation, grades] = showValuation ? await Promise.all([getParcelValuation(p.id), listGrades()]) : [null, []];
  const owners = p.parcel_owners.filter((o) => !o.valid_to);
  const tu = await getTranslations("parcels.landUnits");
  const holdsUnits = p.layout !== "house";
  const [land, parent] = await Promise.all([holdsUnits ? getLandUnits(p.id) : null, p.parent_id ? getParentLand(p.parent_id) : null]);
  const money = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const td = await getTranslations("demolitions");
  const tr = await getTranslations("parcels.rebill");
  const canSeeDemolitions = viewer.can("parcels.demolitions");
  const demolitions = canSeeDemolitions ? await openDemolitionOf(p.id) : [];
  const waiting = demolitions.find((x) => x.status === "pending");
  const underDemolition = demolitions.find((x) => x.status === "approved" && !x.rebuilt_at);
  const hasMoney = (await parcelsWithMoney([p.id])).has(p.id);
  // A flats building: its manager and extra areas; new people can be registered from here by staff who add owners.
  const [extras, ownerDistricts] = p.layout === "flats"
    ? await Promise.all([buildingExtras(p.id), viewer.can("owners.create") ? listDistricts() : Promise.resolve(null)])
    : [null, null];
  // Partial land whose bill no longer matches its size and type (after an edit): Re-bill and Approve.
  const billCheck = partial && p.layout === "house" && p.building_state !== "demolished"
    ? (((await (await createClient()).rpc("parcel_bill_check", { p_parcel: p.id })).data ?? null) as BillCheck)
    : null;
  // Demolished land is an archive: it can be seen, nothing else.
  const archived = p.building_state === "demolished";
  const canMark =
    (viewer.can("parcels.demolish") || viewer.can("parcels.demolish_approve")) &&
    p.status === "registered" && p.building_state === "standing" && !p.locked_at && !waiting && parent?.layout !== "flats";
  const num = (n: number | null, unit: string) => (n != null ? `${format.number(Number(n), { maximumFractionDigits: 1 })} ${unit}` : "—");
  const facts: [string, React.ReactNode][] = [
    [t("account"), <Mono key="a">{p.account_no ?? "—"}</Mono>],
    ...(p.building_no ? [[tu("buildingNo"), <Mono key="b">{p.building_no}</Mono>] as [string, React.ReactNode]] : []),
    ...(holdsUnits ? [[tu("kind"), tu(`layout_${p.layout}`) + (p.floors ? ` · ${tu("floorCount", { count: p.floors })}` : "")] as [string, React.ReactNode]] : []),
    ...(parent
      ? [
          [
            tu(`partOf_${parent.layout}`),
            <Link key="land" href={`/parcels/${parent.id}`} className="hover:text-primary">
              <Mono>{parent.pun ?? "—"}</Mono>
            </Link>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(p.unit_floor != null ? [[tu("floor"), p.unit_floor] as [string, React.ReactNode]] : []),
    [t("area"), num(p.area_m2, "m²")],
    ...(p.parent_id && p.unit_factor != null && parent?.layout === "flats" ? [[tu("unitFactor"), Number(p.unit_factor).toFixed(2)] as [string, React.ReactNode]] : []),
    ...(p.parent_id && Number(p.shared_m2) > 0
      ? [
          [tu("ownM2"), num(p.own_m2, "m²")] as [string, React.ReactNode],
          [tu("sharedM2"), num(p.shared_m2, "m²")] as [string, React.ReactNode],
        ]
      : []),
    [t("perimeter"), num(p.perimeter_m, "m")],
    [ta("propertyType"), propertyTypeName(propertyTypes, p.property_type, lang) ?? "—"],
    [ts("landUse"), ts(`landUses.${p.land_use}`)],
    [t("place"), [p.district && (lang === "so" ? p.district.name_so : p.district.name_en), p.neighbourhood && (lang === "so" ? p.neighbourhood.name_so : p.neighbourhood.name_en)].filter(Boolean).join(" · ")],
    [ta("plotNo"), p.plot_no ?? "—"],
    [t("houseNo"), fullHouseNo(p.neighbourhood?.code, p.house_no) ?? "—"],
    ...(p.flat_no && parent?.layout !== "compound" ? [[t("flatNo"), p.flat_no] as [string, string]] : []),
    [ta("oldDeedNo"), p.deed_no ?? "—"],
    [t("registeredOn"), p.registered_at ? format.dateTime(new Date(p.registered_at), { dateStyle: "medium" }) : "—"],
    // Registered land: the next yearly tax bill (its certificate ends the same day).
    ...(p.status === "registered" && p.tax_anniversary && p.building_state !== "demolished"
      ? [[t("nextTaxBill"), format.dateTime(nextAnniversary(p.tax_anniversary), { dateStyle: "medium" })] as [string, React.ReactNode]]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t("title")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{p.pun ?? t("noPun")}</Mono>
            <ParcelStatusBadge status={p.status} />
            {/* Paid or owing; not on demolished land, where the house is no longer there. */}
            {owed !== null && p.building_state !== "demolished" && (
              <StatusBadge tone={owed > 0 ? "pending" : "paid"}>
                {owed > 0 ? t("notPaidLabel") : t("paidLabel")}
              </StatusBadge>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SiteCheckButtons
              parcelId={p.id}
              canRequest={!archived && p.site_check_status !== "pending" && (viewer.can("parcels.update") || viewer.can("parcels.approve") || viewer.can("surveys.approve"))}
              canAnswer={!archived && p.site_check_status === "pending" && ((p.site_check_surveyor === viewer.user.id && viewer.can("surveys.update")) || viewer.can("surveys.approve"))}
            />
            {canMark && <MarkDemolished canApprove={viewer.can("parcels.demolish_approve")} preset={{ id: p.id, pun: p.pun }} size="sm" />}
            <ParcelRowActions
              parcel={p}
              onDetail
              can={archived ? { update: false, lock: false } : {
                // A building's sizes are fixed once saved. A flat or house can be deleted until it's registered; land with money received can't.
                update: viewer.can("parcels.update") && !holdsUnits,
                lock: viewer.can("parcels.lock"),
                delete: (!p.parent_id || partial) && !hasMoney && (partial ? viewer.can("parcels.delete") : viewer.can("parcels.delete_registered")),
              }}
            />
          </div>
        }
      />
      {archived && (
        <Alert tone="warning" className="mb-5" title={td("archiveTitle")}>
          {td("archiveBody")}
        </Alert>
      )}
      {p.site_check_status && (
        <Alert
          tone={p.site_check_status === "confirmed" ? "success" : p.site_check_status === "not_found" ? "danger" : "info"}
          className="mb-5"
          title={t(`siteCheck.status_${p.site_check_status}`)}
        >
          {[
            p.site_check_note,
            p.site_check_status === "pending" && p.site_check_requested_at && t("siteCheck.since", { date: format.dateTime(new Date(p.site_check_requested_at), { dateStyle: "medium" }) }),
            p.site_check_done_at && t("siteCheck.on", { date: format.dateTime(new Date(p.site_check_done_at), { dateStyle: "medium" }) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Alert>
      )}
      {p.building_state === "demolished" && (
        <Alert tone="danger" className="mb-5" title={td("parcelDemolished")}>
          {td("parcelDemolishedBody")}{" "}
          {underDemolition && canSeeDemolitions && (
            <Link href={`/demolished/${underDemolition.id}`} className="font-medium underline">
              {underDemolition.number}
            </Link>
          )}
        </Alert>
      )}
      {waiting && (
        <Alert tone="info" className="mb-5" title={td("parcelWaiting")}>
          <Link href={`/demolished/${waiting.id}`} className="font-medium underline">
            {waiting.number}
          </Link>
        </Alert>
      )}
      {p.locked_at && (
        <Alert tone="warning" className="mb-5" title={t("lockedTitle", { date: format.dateTime(new Date(p.locked_at), { dateStyle: "medium" }) })}>
          {p.lock_reason}
        </Alert>
      )}
      {billCheck?.differs && (viewer.can("parcels.update") || viewer.can("parcels.approve")) && (
        <Card className="border-status-pending/40 mb-5">
          <CardHeader>
            <CardTitle className="text-base">{tr("title")}</CardTitle>
            <p className="text-muted-foreground text-sm">{tr("body")}</p>
          </CardHeader>
          <CardContent>
            <PartialRebill
              parcelId={p.id}
              check={billCheck}
              can={{ rebill: viewer.can("parcels.update") && !p.locked_at }}
            />
          </CardContent>
        </Card>
      )}
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
        <GeometryPreview geometry={p.geom} className="h-72 md:h-full" pin />
        {land && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{tu(p.layout === "flats" ? "flatsTitle" : "housesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {/* Flats: the building's shares come from its footprint × floors; the rest of the plot is open ground,
                  billed to the building management. */}
              {p.layout === "flats" && (
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">{tu("footprint")}</dt>
                    <dd className="tabular-nums">{p.footprint_m2 != null ? num(p.footprint_m2, "m²") : tu("footprintMissing")}</dd>
                    {p.footprint_m2 != null && (
                      <>
                        <dt className="text-muted-foreground">{tu("builtSpace")}</dt>
                        <dd className="tabular-nums">{num(Number(p.footprint_m2) * (p.floors ?? 1), "m²")} ({num(p.footprint_m2, "m²")} × {p.floors ?? 1})</dd>
                        <dt className="text-muted-foreground">{tu("openGroundShort")}</dt>
                        <dd className="tabular-nums">{num(Math.max(Number(p.area_m2 ?? 0) - Number(p.footprint_m2), 0), "m²")}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">{tu("managerName")}</dt>
                    <dd>{p.manager_name ? `${p.manager_name}${p.manager_phone ? ` · ${p.manager_phone}` : ""}` : "—"}</dd>
                  </dl>
                  {missingFloors(p.floors, land.units.map((u) => u.unit_floor)).length > 0 && (
                    <p className="bg-status-pending/10 text-status-pending w-full rounded-md px-3 py-2 text-xs sm:order-last">
                      {tu("missingFloors", {
                        count: missingFloors(p.floors, land.units.map((u) => u.unit_floor)).length,
                        list: missingFloors(p.floors, land.units.map((u) => u.unit_floor)).join(", "),
                      })}
                    </p>
                  )}
                  {viewer.can("parcels.update") && !archived && (
                    <BuildingTaxEdit
                      id={p.id}
                      plotM2={p.area_m2 != null ? Number(p.area_m2) : null}
                      current={{ footprint: p.footprint_m2 != null ? Number(p.footprint_m2) : null, managerName: p.manager_name, managerPhone: p.manager_phone }}
                    />
                  )}
                </div>
              )}
              {/* Flats: the manager (a person, like an owner) and the extra areas (parking, playgrounds, …) on their bill. */}
              {p.layout === "flats" && extras && (
                <BuildingManagerAreas
                  buildingId={p.id}
                  manager={extras.manager}
                  legacyName={extras.legacyName}
                  areas={extras.areas}
                  canEdit={(viewer.can("parcels.update") || viewer.can("valuation.update")) && !archived}
                  newOwner={ownerDistricts ? { districts: ownerDistricts, districtId: ownerDistricts.find((d) => d.code === p.district?.code)?.id ?? null } : null}
                />
              )}
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b text-start">
                    <th className="py-2 pe-3 text-start font-medium">PUN</th>
                    {p.layout === "flats" && <th className="py-2 pe-3 text-start font-medium">{tu("floor")}</th>}
                    <th className="py-2 pe-3 text-end font-medium">{tu("ownM2")}</th>
                    {p.layout === "flats" && (
                      <>
                        <th className="py-2 pe-3 text-end font-medium">{tu("unitFactor")}</th>
                        <th className="py-2 pe-3 text-end font-medium">{tu("taxableM2")}</th>
                      </>
                    )}
                    {p.layout === "compound" && (
                      <>
                        <th className="py-2 pe-3 text-end font-medium">{tu("sharedM2")}</th>
                        <th className="py-2 pe-3 text-end font-medium">{tu("totalM2")}</th>
                      </>
                    )}
                    <th className="py-2 pe-3 text-start font-medium">{t("owners")}</th>
                    <th className="py-2 text-end font-medium">{tu("owes")}</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${zebraRows}`}>
                  {land.units.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 pe-3">
                        <Link href={`/parcels/${u.id}`} className="hover:text-primary">
                          <Mono>{u.pun ?? u.unit_no}</Mono>
                        </Link>
                      </td>
                      {p.layout === "flats" && <td className="py-2 pe-3 tabular-nums">{u.unit_floor ?? "—"}</td>}
                      <td className="py-2 pe-3 text-end tabular-nums">{num(u.own_m2, "m²")}</td>
                      {p.layout === "flats" && (
                        <>
                          <td className="py-2 pe-3 text-end tabular-nums">{u.unit_factor != null ? Number(u.unit_factor).toFixed(2) : "—"}</td>
                          <td className="py-2 pe-3 text-end font-medium tabular-nums">{num(u.area_m2, "m²")}</td>
                        </>
                      )}
                      {p.layout === "compound" && (
                        <>
                          <td className="py-2 pe-3 text-end tabular-nums">{num(u.shared_m2, "m²")}</td>
                          <td className="py-2 pe-3 text-end font-medium tabular-nums">{num(u.area_m2, "m²")}</td>
                        </>
                      )}
                      <td className="py-2 pe-3">{u.owners.join(", ") || "—"}</td>
                      <td className={`py-2 text-end tabular-nums ${u.owed > 0 ? "font-medium text-danger" : ""}`}>{money(u.owed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {land.spaces.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="text-sm font-medium">{tu("sharedTitle")}</p>
                  <p className="mb-2 text-xs text-muted-foreground">{tu(p.shared_split === "by_size" ? "splitBySize" : "splitEqual")}</p>
                  <ul className="space-y-1 text-sm">
                    {land.spaces.map((s) => (
                      <li key={s.id} className="flex justify-between gap-3">
                        <span>{s.name === "Empty land" ? tu("emptyLand") : s.name}</span>
                        <span className="tabular-nums">{num(s.area_m2, "m²")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {!holdsUnits && <Card>
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
        </Card>}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {p.parcel_history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{t.has(`events.${h.action}`) ? t(`events.${h.action}`) : h.action}</span>
                  {(h.detail?.transferKind || h.detail?.changeKind) && (
                    <span className="ms-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                      {h.detail.transferKind ? tl(`transferKinds.${h.detail.transferKind}`) : tl(`changeKinds.${h.detail.changeKind}`)}
                    </span>
                  )}
                  {h.detail?.number && <Mono className="ms-1.5 text-xs">{h.detail.number}</Mono>}
                  <span className="ms-2 text-xs text-muted-foreground">{format.dateTime(new Date(h.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                  {h.detail?.from && h.detail.to && (
                    <p className="text-muted-foreground">{t("historyFromTo", { from: h.detail.from.join(", ") || "—", to: h.detail.to.join(", ") || "—" })}</p>
                  )}
                  {h.detail?.puns && h.detail.puns.length > 0 && (
                    <p className="text-muted-foreground">
                      {h.action === "created_from" ? t("historyFrom") : t("historyInto")} <Mono>{h.detail.puns.join(", ")}</Mono>
                    </p>
                  )}
                  {h.detail?.landUse && <p className="text-muted-foreground">{t("historyLandUse", { use: ts(`landUses.${h.detail.landUse}`) })}</p>}
                  {h.note && h.note !== h.detail?.number && <p className="text-muted-foreground">{h.note}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        {viewer.can("transfers.view") && p.pun && !holdsUnits && (
          <div className="md:col-span-2">
            <TransferHistory parcelId={p.id} />
          </div>
        )}
        {viewer.can("certificates.view") && p.pun && !holdsUnits && (
          <div className="md:col-span-2">
            <ParcelCertificate parcelId={p.id} pun={p.pun} canIssue={viewer.can("certificates.approve") && !archived} />
          </div>
        )}
        {viewer.can("invoices.view") && !holdsUnits && (
          <div className="md:col-span-2">
            <ParcelInvoices parcelId={p.id} canCreate={viewer.can("invoices.create") && !archived} />
          </div>
        )}
        {valuation && !holdsUnits && (
          <div className="md:col-span-2">
            <ParcelValuation
              parcelId={p.id}
              registered={p.status === "registered" || p.status === "disputed"}
              data={valuation}
              grades={grades}
              can={{ edit: viewer.can("valuation.update") && !archived, assess: viewer.can("valuation.create") && !archived }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
