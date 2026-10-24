import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { NewOwnerForm } from "./new-owner-form";

export default async function NewOwnerPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ zone?: string; nbhd?: string }> }) {
  const { locale } = await params;
  const { zone, nbhd } = await searchParams;
  const uuid = /^[0-9a-f-]{36}$/i;
  // From a survey zone: after saving, straight on to Add land in that zone for this owner.
  const fromZone = zone && nbhd && uuid.test(zone) && uuid.test(nbhd) ? { zone, nbhd } : null;
  setRequestLocale(locale);
  await requirePermission(locale, "owners.create");
  const t = await getTranslations("owners");
  const districts = await listDistricts();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("new")} description={t("newSubtitle")} />
      <Card>
        <CardContent>
          <NewOwnerForm districts={districts} fromZone={fromZone} />
        </CardContent>
      </Card>
    </div>
  );
}
