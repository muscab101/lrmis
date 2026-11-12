import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { zoneFormData } from "../zone-forms";
import { ZoneOwnerForm } from "./zone-owner-form";

export async function generateMetadata() {
  const t = await getTranslations("owners");
  return { title: t("new") };
}

/** Survey zone → New owner: the owner form as a page inside Surveys; next, Add land for this owner in the same zone. */
export default async function ZoneNewOwnerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "owners.create");
  const t = await getTranslations("owners");
  const tz = await getTranslations("yetToRegister.zone");
  const { zone, districts, start } = await zoneFormData(id, viewer);
  const canAddLand = viewer.can("surveys.create") || viewer.can("applications.create");
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/surveys/zones/${id}`} className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft className="size-4" aria-hidden />
        {tz("backToZone", { zone: zone.code })}
      </Link>
      <PageHeader title={t("new")} description={t("newSubtitle")} />
      <Card>
        <CardContent>
          <ZoneOwnerForm zoneId={id} districts={districts} districtId={start?.district_id ?? null} canAddLand={canAddLand} />
        </CardContent>
      </Card>
    </div>
  );
}
