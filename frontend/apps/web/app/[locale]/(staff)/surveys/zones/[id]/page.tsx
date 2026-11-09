import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Home, MapPinPlus, UserPlus, UserRound } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { ZoneCloseButtons } from "@/components/parcels/zone-close-buttons";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { searchParcels } from "@/lib/server/parcels";
import { createClient } from "@/lib/supabase/server";
import { listZones } from "@/lib/server/zones";
import { fullHouseNo } from "@/lib/house-no";

export async function generateMetadata() {
  const t = await getTranslations("yetToRegister.zone");
  return { title: t("title") };
}

/** One survey zone: how far it is (houses / capacity) and every house recorded in its neighbourhood. Land is registered from Parcels, not here. */
export default async function ZonePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "surveys.view");
  const t = await getTranslations("yetToRegister.zone");
  const tp = await getTranslations("parcels");
  const format = await getFormatter();
  const lang = await getLocale();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const zone = (await listZones(false, "any")).find((z) => z.id === id);
  if (!zone) notFound();
  const supabase = await createClient();
  const [houses, waitingRes] = await Promise.all([
    searchParcels("", "all", zone.neighbourhood_id),
    supabase.rpc("zone_owners_waiting", { p_zone: id }),
  ]);
  // Owners added here whose land was never added: carry on with each one.
  const waiting = (waitingRes.data ?? []) as { party_id: string; full_name: string; phone: string | null; created_at: string }[];
  const open = zone.status === "open";
  const mine = zone.surveyor_id === viewer.user.id;
  const canAddLand = open && (mine || viewer.can("surveys.approve")) && (viewer.can("surveys.create") || viewer.can("applications.create"));
  const pct = Math.min(100, Math.round((zone.recorded / zone.target) * 100));
  const name = lang === "so" ? zone.name_so : zone.name_en;

  return (
    <>
      <PageHeader
        eyebrow={`${t("eyebrow")} · ${lang === "so" ? zone.district_so : zone.district_en}`}
        title={
          <>
            {name} <Mono className="text-muted-foreground text-base">{zone.code}</Mono>
          </>
        }
        description={zone.note ?? (mine ? t("yours") : t("assignedTo", { name: zone.surveyor ?? "—" }))}
        actions={
          <div className="flex flex-wrap gap-2">
            {canAddLand && (
              <Button asChild>
                <Link href={`/parcels/new?${new URLSearchParams({ nbhd: zone.neighbourhood_id, zone: zone.id })}`}>
                  <MapPinPlus aria-hidden />
                  {t("addLand")}
                </Link>
              </Button>
            )}
            {open && (mine || viewer.can("surveys.approve")) && viewer.can("owners.create") && (
              <Button asChild variant="outline">
                <Link href={`/owners/new?${new URLSearchParams({ zone: zone.id, nbhd: zone.neighbourhood_id })}`}>
                  <UserPlus aria-hidden />
                  {t("addOwner")}
                </Link>
              </Button>
            )}
            {/* Mark done only once every house is recorded (e.g. 50 of 50); zones are not cancelled from here. */}
            {open && zone.recorded >= zone.target && (
              <ZoneCloseButtons id={zone.id} name={name} canDone={mine || viewer.can("surveys.approve")} canCancel={false} />
            )}
          </div>
        }
      />

      <Card className="mb-5">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-caps text-muted-foreground">{t("houses")}</div>
              <div className="text-4xl font-semibold tabular-nums">
                {format.number(zone.recorded)}
                <span className="text-muted-foreground text-2xl"> / {format.number(zone.target)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <KpiChip label={t("waiting")} value={format.number(zone.partial)} />
              <KpiChip label={t("registered")} value={format.number(zone.registered)} tone="success" />
              <KpiChip label={t("left")} value={format.number(Math.max(0, zone.target - zone.recorded))} />
            </div>
          </div>
          <div className="bg-muted mt-4 h-2.5 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("houses")}>
            <div className={`h-full ${pct >= 100 ? "bg-status-approved" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          {!open && <p className="text-muted-foreground mt-2 text-sm">{t(`closed_${zone.status}`)}</p>}
        </CardContent>
      </Card>

      {waiting.length > 0 && (
        <Card className="border-status-pending/40 mb-5 overflow-hidden">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <UserRound className="text-status-pending size-4" aria-hidden />
              <h2 className="font-semibold">{t("waitingOwners", { n: waiting.length })}</h2>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">{t("waitingOwnersBody")}</p>
            <ul className="mt-3 divide-y rounded-md border">
              {waiting.map((o) => (
                <li key={o.party_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
                  <Link href={`/owners/${o.party_id}`} className="hover:text-primary font-medium">
                    {o.full_name}
                  </Link>
                  {o.phone && <Mono className="text-muted-foreground text-xs">{o.phone}</Mono>}
                  <span className="text-muted-foreground text-xs">{format.dateTime(new Date(o.created_at), { dateStyle: "medium", timeStyle: "short" })}</span>
                  {canAddLand && (
                    <Button asChild size="sm" className="ms-auto">
                      <Link href={`/parcels/new?${new URLSearchParams({ nbhd: zone.neighbourhood_id, zone: zone.id, owner: o.party_id })}`}>
                        <MapPinPlus aria-hidden />
                        {t("addLandFor")}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        {houses.length === 0 ? (
          <EmptyState icon={<Home />} title={t("empty")} description={canAddLand ? t("emptyBody") : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tp("houseNo")}</TableHead>
                <TableHead>{tp("pun")}</TableHead>
                <TableHead>{tp("ownerName")}</TableHead>
                <TableHead>{tp("statusLabel")}</TableHead>
                <TableHead className="hidden md:table-cell">{tp("dateCreated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {houses.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{fullHouseNo(zone.code, p.house_no) ?? "—"}</TableCell>
                  <TableCell>
                    {viewer.can("parcels.view") ? (
                      <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                        <Mono>{p.pun ?? tp("noPun")}</Mono>
                      </Link>
                    ) : (
                      <Mono>{p.pun ?? tp("noPun")}</Mono>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell>
                    <ParcelStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{format.dateTime(new Date(p.created_at), { dateStyle: "medium" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
