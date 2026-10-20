import { Card, CardContent } from "@dhulka/ui/card";
import { Alert, PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationForm } from "@/components/applications/location-form";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { listPropertyTypes } from "@/lib/server/property-types";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("new") };
}

export default async function NewApplicationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ owner?: string }> }) {
  const { locale } = await params;
  const { owner: ownerParam } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "applications.create");
  const t = await getTranslations("applications");
  const supabase = await createClient();
  const [all, { data: mine }] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids")]);
  // Staff can only open applications in their own districts.
  const allowed = new Set((mine as string[] | null) ?? []);
  const districts = all.filter((d) => allowed.has(d.id));
  const propertyTypes = await listPropertyTypes();
  // From the owners list (+): start the application with that owner on it.
  const owner = ownerParam && /^[0-9a-f-]{36}$/i.test(ownerParam)
    ? ((await supabase.from("parties").select("id, full_name, district_id").eq("id", ownerParam).is("deleted_at", null).maybeSingle()).data as { id: string; full_name: string; district_id: string | null } | null)
    : null;
  const ownerDistrict = owner?.district_id && allowed.has(owner.district_id) ? owner.district_id : "";
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={t("stepOf", { step: 1, total: 4 })} title={t("new")} description={t("newSubtitle")} />
      {owner && <Alert className="mb-4" title={t("forOwner", { name: owner.full_name })} />}
      <Card>
        <CardContent className="pt-5">
          <LocationForm
            ownerId={owner?.id}
            propertyTypes={propertyTypes}
            mode="create"
            canCaptureLocation={viewer.can("applications.capture_location")}
            isStaff
            basePath="/applications"
            districts={districts}
            initial={{
              type: "new_registration",
              channel: "office",
              districtId: ownerDistrict || (districts.length === 1 ? districts[0]!.id : ""),
              neighbourhood: null,
              pin: null,
              addressNote: "",
              plotNo: "",
              oldDeedNo: "",
              govtFileNo: "", houseNo: "", govtReceiptNo: "", propertyType: "", landUse: "", plotWidthM: "", plotLengthM: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
