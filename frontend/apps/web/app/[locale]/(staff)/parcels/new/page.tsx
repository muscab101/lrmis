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
export default async function AddFieldLandPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ nbhd?: string }> }) {
  const { locale } = await params;
  const { nbhd } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  if (!viewer.can("surveys.create") && !viewer.can("applications.create")) forbidden();
  const t = await getTranslations("parcels.fieldLand");
  const supabase = await createClient();
  const [all, { data: mine }, grades] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids"), listPropertyTypes()]);
  const allowed = new Set((mine as string[] | null) ?? []);
  // From a survey zone: start in its neighbourhood.
  const start = nbhd && /^[0-9a-f-]{36}$/i.test(nbhd)
    ? ((await supabase.from("neighbourhoods").select("id, district_id, code, name_so, name_en").eq("id", nbhd).maybeSingle()).data as
        | { id: string; district_id: string; code: string; name_so: string; name_en: string }
        | null)
    : null;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardContent className="pt-5">
          <FieldLandForm districts={all.filter((d) => allowed.has(d.id))} grades={grades} start={start && allowed.has(start.district_id) ? start : null} />
        </CardContent>
      </Card>
    </div>
  );
}
