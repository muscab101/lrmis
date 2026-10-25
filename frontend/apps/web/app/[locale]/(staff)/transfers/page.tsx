import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowRightLeft, Banknote, Eye, MapPinned, Search } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { ParcelLegalCard } from "@/components/legal/parcel-legal";
import { legalCounts, listTransfers, parcelLegal, type RequestStatus } from "@/lib/server/legal";
import { getParcel } from "@/lib/server/parcels";
import { createClient } from "@/lib/supabase/server";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("transfersTitle") };
}

const FILTERS = ["submitted", "draft", "approved", "rejected", "cancelled", "any"] as const;

export default async function TransfersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "transfers.view");
  const canCollect = viewer.can("cashier.view");
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as RequestStatus | "any") : "submitted";
  const [rows, counts] = await Promise.all([listTransfers(filter), legalCounts()]);
  const badge: Partial<Record<string, number>> = { submitted: counts.transfers_waiting, draft: counts.transfers_draft };
  const names = (o: { full_name: string }[]) => o.map((x) => x.full_name).join(", ") || "—";
  // Legal work on one parcel (transfer, subdivide, merge, change of use, correction, permit, dispute, lien, court
  // order): find it by its PUN (dashes from an old printout are ignored).
  const pun = (sp.pun ?? "").trim().toUpperCase().replace(/-/g, "").slice(0, 30);
  const found = pun
    ? ((await (await createClient()).from("parcels").select("id").eq("pun", pun).is("deleted_at", null).maybeSingle()).data as { id: string } | null)
    : null;
  const parcel = found ? await getParcel(found.id) : null;
  const legal = parcel ? await parcelLegal(parcel.id) : null;
  // New owners can be registered from the transfer form by staff allowed to create owners.
  const ownerDistricts = parcel && viewer.can("owners.create") ? await listDistricts() : null;
  const newOwner = parcel && ownerDistricts ? { districts: ownerDistricts, districtId: ownerDistricts.find((d) => d.code === parcel.district?.code)?.id ?? null } : null;

  return (
    <>
      <PageHeader title={t("transfersTitle")} description={t("transfersSubtitle")} />
      <Card className="mb-5">
        <CardContent className="pt-5">
          <form className="flex flex-wrap items-end gap-2" role="search">
            <label className="grid min-w-60 flex-1 gap-1 text-sm">
              <span className="text-muted-foreground text-xs">{t("findParcel")}</span>
              <Input name="pun" defaultValue={pun} placeholder="BN010101" className="font-mono" autoComplete="off" />
            </label>
            <Button type="submit" variant="outline">
              <Search aria-hidden />
              {t("find")}
            </Button>
          </form>
          {pun && !parcel && <p className="text-muted-foreground mt-3 text-sm">{t("parcelNotFound", { pun })}</p>}
        </CardContent>
      </Card>
      {parcel && legal && (
        <div className="mb-5">
          <p className="mb-2 text-sm">
            <Link href={`/parcels/${parcel.id}`} className="hover:text-primary">
              <Mono className="font-medium">{parcel.pun}</Mono>
            </Link>
            <span className="text-muted-foreground"> · {parcel.parcel_owners.filter((o) => !o.valid_to).map((o) => o.party.full_name).join(", ") || "—"}</span>
          </p>
          <ParcelLegalCard
            parcel={{ id: parcel.id, pun: parcel.pun!, ownership: parcel.ownership, land_use: parcel.land_use, status: parcel.status, plot_no: parcel.plot_no, deed_no: parcel.deed_no, govt_file_no: parcel.govt_file_no, developed: parcel.developed }}
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
            newOwner={newOwner}
          />
        </div>
      )}
      <Card className="overflow-hidden">
        <nav className="flex flex-wrap gap-1.5 border-b p-3 text-sm">
          {FILTERS.map((f) => (
            <Link key={f} href={`/transfers?f=${f}`} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {f === "any" ? t("all") : t(`status.${f}`)}
              {badge[f] ? <span className="ms-1.5 font-mono text-[11px]">{badge[f]}</span> : null}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState icon={<ArrowRightLeft />} title={t("noTransfers")} description={t("noTransfersBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("number")}</TableHead>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead>{t("kind")}</TableHead>
                <TableHead>{t("from")}</TableHead>
                <TableHead>{t("to")}</TableHead>
                <TableHead>{t("duty")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/transfers/${r.id}`} className="hover:text-primary">
                      <Mono>{r.number}</Mono>
                    </Link>
                    <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(r.created_at), { dateStyle: "medium" })}</span>
                  </TableCell>
                  <TableCell>
                    <Mono>{r.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{t(`transferKinds.${r.kind}`)}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{names(r.from_owners)}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{names(r.to_owners)}</TableCell>
                  <TableCell className="text-sm">
                    {r.duty_invoice ? (
                      <>
                        {format.number(Number(r.duty_invoice.total), { style: "currency", currency: "USD" })}
                        <span className={`block text-xs ${Number(r.duty_invoice.balance) > 0 ? "text-status-rejected" : "text-status-approved"}`}>
                          {Number(r.duty_invoice.balance) > 0 ? t("dutyUnpaid") : t("dutyPaid")}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{t(`status.${r.status}`)}</TableCell>
                  <TableCell>
                    {/* View the transfer (approve, reject and the rest are there), its parcel, and take the duty. */}
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                        <Link href={`/transfers/${r.id}`} aria-label={t("viewTransfer")} title={t("viewTransfer")}>
                          <Eye aria-hidden />
                        </Link>
                      </Button>
                      {r.parcel && (
                        <Button variant="ghost" size="icon-sm" asChild>
                          <Link href={`/parcels/${r.parcel.id}`} aria-label={t("viewParcel")} title={t("viewParcel")}>
                            <MapPinned aria-hidden />
                          </Link>
                        </Button>
                      )}
                      {canCollect && r.duty_invoice && Number(r.duty_invoice.balance) > 0 && (
                        <Button variant="ghost" size="icon-sm" className="text-status-approved" asChild>
                          <Link href={`/cashier?find=${encodeURIComponent(r.duty_invoice.number)}`} aria-label={t("takeDuty")} title={t("takeDuty")}>
                            <Banknote aria-hidden />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
