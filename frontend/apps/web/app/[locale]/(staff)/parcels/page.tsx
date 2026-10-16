import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { MapPinned } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { searchParcels } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("parcels");
  return { title: t("title") };
}

export default async function ParcelsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "parcels.view");
  const t = await getTranslations("parcels");
  const format = await getFormatter();
  const q = ((await searchParams).q ?? "").slice(0, 80);
  const rows = await searchParcels(q);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="overflow-hidden">
        <form className="border-b p-3" role="search">
          <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="max-w-md" />
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<MapPinned />} title={q ? t("noMatches") : t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pun")}</TableHead>
                <TableHead>{t("owners")}</TableHead>
                <TableHead>{t("place")}</TableHead>
                <TableHead className="text-end">{t("area")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                      <Mono>{p.pun ?? t("noPun")}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {p.district}
                    {p.neighbourhood && <span className="text-muted-foreground"> · {p.neighbourhood}</span>}
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{p.area_m2 != null ? `${format.number(Number(p.area_m2), { maximumFractionDigits: 1 })} m²` : "—"}</TableCell>
                  <TableCell>
                    <ParcelStatusBadge status={p.status} />
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
