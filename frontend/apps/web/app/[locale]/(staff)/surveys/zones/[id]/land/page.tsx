import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { ArrowLeft } from "lucide-react";
import { forbidden } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FieldLandForm } from "@/components/parcels/field-land-form";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { zoneFormData } from "../zone-forms";

export async function generateMetadata() {
  const t = await getTranslations("parcels.fieldLand");
  return { title: t("title") };
}

/** Survey zone → Add land: the field land form as a page inside Surveys, in the zone's neighbourhood; back to the zone when saved. */
export default async function ZoneAddLandPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ owner?: string }>;
}) {
  const { locale, id } = await params;
  const { owner } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  if (!viewer.can("surveys.create") && !viewer.can("applications.create")) forbidden();
  const t = await getTranslations("parcels.fieldLand");
  const tz = await getTranslations("yetToRegister.zone");
  const { zone, districts, grades, start } = await zoneFormData(id, viewer);
  // Coming from New owner (or "Add land for" a waiting owner): the land is theirs.
  const ownerRow =
    owner && /^[0-9a-f-]{36}$/i.test(owner)
      ? ((await (await createClient()).from("parties").select("id, full_name, phone").eq("id", owner).maybeSingle()).data as {
          id: string;
          full_name: string;
          phone: string | null;
        } | null)
      : null;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/surveys/zones/${id}`} className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft className="size-4" aria-hidden />
        {tz("backToZone", { zone: zone.code })}
      </Link>
      <PageHeader title={t("title")} description={ownerRow ? ownerRow.full_name : t("subtitle")} />
      <Card>
        <CardContent className="pt-5">
          <FieldLandForm districts={districts} grades={grades} start={start} returnTo={`/surveys/zones/${id}`} owner={ownerRow} />
        </CardContent>
      </Card>
    </div>
  );
}
