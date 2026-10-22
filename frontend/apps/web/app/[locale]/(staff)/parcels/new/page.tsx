import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { forbidden } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FieldLandForm } from "@/components/parcels/field-land-form";
import { requirePermission } from "@/lib/server/auth";
import { listPropertyTypes } from "@/lib/server/property-types";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("parcels.fieldLand");
  return { title: t("title") };
}

/** Surveyors (and admins) add land found in the field; it lands in Parcels → Partial registration. */
export default async function AddFieldLandPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  if (!viewer.can("surveys.create") && !viewer.can("applications.create")) forbidden();
  const t = await getTranslations("parcels.fieldLand");
  const supabase = await createClient();
  const [all, { data: mine }, grades] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids"), listPropertyTypes()]);
  const allowed = new Set((mine as string[] | null) ?? []);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardContent className="pt-5">
          <FieldLandForm districts={all.filter((d) => allowed.has(d.id))} grades={grades} />
        </CardContent>
      </Card>
    </div>
  );
}
