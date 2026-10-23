import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Home, MapPinPlus, UserPlus } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { StartRegistrationButton } from "@/components/parcels/start-registration-button";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { searchParcels } from "@/lib/server/parcels";
import { listZones } from "@/lib/server/zones";

export async function generateMetadata() {
  const t = await getTranslations("yetToRegister.zone");
  return { title: t("title") };
}

/** One survey zone: how far it is (houses / capacity) and every house recorded in its neighbourhood. */
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
  const houses = await searchParcels("", "all", zone.neighbourhood_id);
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {houses.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm font-medium">{p.house_no ?? "—"}</TableCell>
                  <TableCell>
                    {viewer.can("parcels.view") ? (
                      <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                        <Mono>{p.pun ?? p.application_number ?? tp("noPun")}</Mono>
                      </Link>
                    ) : (
                      <Mono>{p.pun ?? p.application_number ?? tp("noPun")}</Mono>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell>
                    <ParcelStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{format.dateTime(new Date(p.created_at), { dateStyle: "medium" })}</TableCell>
                  <TableCell className="text-end">
                    {!p.application_number && p.status === "draft" && viewer.can("applications.create") ? (
                      <StartRegistrationButton parcelId={p.id} label={[name, p.house_no && `${tp("houseNoShort")} ${p.house_no}`].filter(Boolean).join(" · ")} />
                    ) : p.application_number && p.status !== "registered" ? (
                      <Link href={`/applications?${new URLSearchParams({ q: p.application_number, status: "any" })}`} className="text-primary text-xs underline">
                        {tp("openApplication", { number: p.application_number })}
                      </Link>
                    ) : null}
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
