import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { forbidden } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FieldLandForm } from "@/components/parcels/field-land-form";
import { requireStaff } from "@/lib/server/auth";
import { listPropertyTypes } from "@/lib/server/property-types";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("parcels.fieldLand");
  return { title: t("title") };
}

/** Surveyors (and admins) add land found in the field; it lands in Parcels → Partial registration. */
export default async function AddFieldLandPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ nbhd?: string; zone?: string; owner?: string }> }) {
  const { locale } = await params;
  const { nbhd, zone, owner } = await searchParams;
  setRequestLocale(locale);
  // Surveyors add land without seeing the whole Parcels list.
  const viewer = await requireStaff(locale);
  if (!viewer.can("surveys.create") && !viewer.can("applications.create")) forbidden();
  const t = await getTranslations("parcels.fieldLand");
  const supabase = await createClient();
  const [all, { data: mine }, grades] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids"), listPropertyTypes()]);
  const allowed = new Set((mine as string[] | null) ?? []);
  // From a survey zone: start in its neighbourhood. Otherwise a surveyor starts in the neighbourhood of their latest
  // open survey zone, so the map opens right where they are working.
  const zoneNbhd = !nbhd
    ? ((
        await supabase
          .from("survey_zones")
          .select("neighbourhood_id")
          .eq("surveyor_id", viewer.user.id)
          .eq("status", "open")
          .order("assigned_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data as { neighbourhood_id: string } | null)?.neighbourhood_id
    : null;
  const startId = nbhd ?? zoneNbhd;
  const start = startId && /^[0-9a-f-]{36}$/i.test(startId)
    ? ((await supabase.from("neighbourhoods").select("id, district_id, code, name_so, name_en").eq("id", startId).maybeSingle()).data as
        | { id: string; district_id: string; code: string; name_so: string; name_en: string }
        | null)
    : null;
  // From Add owner in a survey zone: the land is for that owner.
  const ownerRow = owner && /^[0-9a-f-]{36}$/i.test(owner)
    ? ((await supabase.from("parties").select("id, full_name, phone").eq("id", owner).maybeSingle()).data as { id: string; full_name: string; phone: string | null } | null)
    : null;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardContent className="pt-5">
          <FieldLandForm districts={all.filter((d) => allowed.has(d.id))} grades={grades} start={start && allowed.has(start.district_id) ? start : null}
            returnTo={zone && /^[0-9a-f-]{36}$/i.test(zone) ? `/surveys/zones/${zone}` : undefined}
            owner={ownerRow}
          />
        </CardContent>
      </Card>
    </div>
  );
}
