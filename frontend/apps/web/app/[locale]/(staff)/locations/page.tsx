import { locationsQuerySchema } from "@dhulka/core/schemas";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { locationCounts, PAGE_SIZE, queryLocations } from "@/lib/server/locations";
import { myDistricts, myScope } from "@/lib/server/scope";
import { LocationsTable } from "./locations-table";

export async function generateMetadata() {
  const t = await getTranslations("locations");
  return { title: t("title") };
}

export default async function LocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "locations.view");
  const t = await getTranslations("locations");
  const query = locationsQuerySchema.parse(await searchParams);
  const scope = await myScope();
  const ids = scope.all ? null : scope.districtIds;
  const [{ rows, total }, districts, allCounts] = await Promise.all([queryLocations(query, ids), myDistricts(), locationCounts()]);
  const counts = ids ? allCounts.filter((c) => ids.includes(c.district_id)) : allCounts;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("subtitle")} />
      <LocationsTable
        rows={rows}
        total={total}
        pageSize={PAGE_SIZE}
        query={query}
        districts={districts}
        counts={counts}
        can={{
          create: viewer.can("locations.create"),
          update: viewer.can("locations.update"),
          archive: viewer.can("locations.delete"),
        }}
      />
    </>
  );
}
