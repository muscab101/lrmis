import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Building2, MapPinned } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { apartmentUnits } from "@/lib/server/apartments";
import { getParcel } from "@/lib/server/parcels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getParcel(id);
  return { title: p?.pun ?? p?.house_no ?? "404" };
}

/** One apartment building, floor by floor (a compound: its houses), with each flat's owner, size, status and debt. */
export default async function ApartmentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "parcels.view");
  const t = await getTranslations("apartments");
  const format = await getFormatter();
  const lang = await getLocale();
  const p = await getParcel(id);
  if (!p || p.layout === "house") notFound();
  const units = await apartmentUnits(p.id);
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const flats = p.layout === "flats";
  const owed = units.reduce((s, u) => s + u.owed, 0);
  // Flats: grouped by floor, top floor first, so every floor of the building shows (an empty floor too).
  const floors = flats ? Array.from({ length: Math.max(p.floors ?? 0, ...units.map((u) => (u.unit_floor ?? 0) + 1), 1) }, (_, i) => i).reverse() : [null];
  const floorName = (f: number | null) => (f === null ? null : f === 0 ? t("ground") : t("floorN", { n: f }));
  const place = [p.neighbourhood && (lang === "so" ? p.neighbourhood.name_so : p.neighbourhood.name_en), p.district && (lang === "so" ? p.district.name_so : p.district.name_en)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t(`kinds.${p.layout}`)}
        title={<Mono>{p.pun ?? p.house_no ?? "—"}</Mono>}
        description={[place, p.manager_name && t("managerLine", { name: p.manager_name, phone: p.manager_phone ?? "" })].filter(Boolean).join(" · ")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/parcels/${p.id}`}>
              <MapPinned aria-hidden />
              {t("openLand")}
            </Link>
          </Button>
        }
      >
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <KpiChip label={flats ? t("flats") : t("houses")} value={format.number(units.length)} />
          <KpiChip label={t("registered")} value={format.number(units.filter((u) => u.status === "registered").length)} />
          <KpiChip label={t("partial")} value={format.number(units.filter((u) => ["draft", "surveyed", "verified"].includes(u.status)).length)} />
          <KpiChip label={t("owed")} value={usd(owed)} />
        </div>
      </PageHeader>

      <Card className="overflow-hidden">
        {units.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t("noUnits")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {flats && <TableHead className="w-28">{t("floor")}</TableHead>}
                <TableHead>{flats ? t("flat") : t("house")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead className="text-end">{t("size")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-end">{t("owed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {floors.flatMap((f) => {
                const here = flats ? units.filter((u) => (u.unit_floor ?? 0) === f) : units;
                if (here.length === 0)
                  return [
                    <TableRow key={`empty-${f}`}>
                      <TableCell className="text-sm font-medium">{floorName(f)}</TableCell>
                      <TableCell colSpan={5} className="text-muted-foreground text-sm italic">
                        {t("emptyFloor")}
                      </TableCell>
                    </TableRow>,
                  ];
                return here.map((u, i) => (
                  <TableRow key={u.id}>
                    {flats && <TableCell className="text-sm font-medium">{i === 0 ? floorName(f) : ""}</TableCell>}
                    <TableCell>
                      <Link href={`/parcels/${u.id}`} className="hover:text-primary">
                        <Mono>{u.flat_no ?? u.unit_no ?? u.pun ?? "—"}</Mono>
                      </Link>
                      {u.pun && <div className="text-muted-foreground text-xs">{u.pun}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{u.owners.join(", ") || "—"}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{u.own_m2 != null ? `${format.number(Number(u.own_m2), { maximumFractionDigits: 1 })} m²` : "—"}</TableCell>
                    <TableCell>
                      <ParcelStatusBadge status={u.status as Parameters<typeof ParcelStatusBadge>[0]["status"]} />
                    </TableCell>
                    <TableCell className={`text-end text-sm tabular-nums ${u.owed > 0 ? "" : "text-muted-foreground"}`}>{u.owed > 0 ? usd(u.owed) : t("paid")}</TableCell>
                  </TableRow>
                ));
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
