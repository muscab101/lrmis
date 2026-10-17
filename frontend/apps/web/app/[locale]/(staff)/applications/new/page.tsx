import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationForm } from "@/components/applications/location-form";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { listDistricts } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("new") };
}

export default async function NewApplicationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "applications.create");
  const t = await getTranslations("applications");
  const supabase = await createClient();
  const [all, { data: mine }] = await Promise.all([listDistricts(), supabase.rpc("user_district_ids")]);
  // Staff can only open applications in their own districts.
  const allowed = new Set((mine as string[] | null) ?? []);
  const districts = all.filter((d) => allowed.has(d.id));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={t("stepOf", { step: 1, total: 4 })} title={t("new")} description={t("newSubtitle")} />
      <Card>
        <CardContent className="pt-5">
          <LocationForm
            mode="create"
            canCaptureLocation={viewer.can("applications.capture_location")}
            isStaff
            basePath="/applications"
            districts={districts}
            initial={{
              type: "new_registration",
              channel: "office",
              districtId: districts.length === 1 ? districts[0]!.id : "",
              neighbourhood: null,
              pin: null,
              addressNote: "",
              plotNo: "",
              oldDeedNo: "",
              govtFileNo: "", plotWidthM: "", plotLengthM: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
