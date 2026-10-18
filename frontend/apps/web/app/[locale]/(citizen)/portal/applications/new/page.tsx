import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationForm } from "@/components/applications/location-form";
import { listDistricts } from "@/lib/server/users";

export default async function PortalNewApplication({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("applications");
  const districts = await listDistricts();
  return (
    <>
      <PageHeader eyebrow={t("stepOf", { step: 1, total: 4 })} title={t("citizenNewTitle")} description={t("citizenNewSubtitle")} />
      <Card>
        <CardContent className="pt-5">
          <LocationForm
            mode="create"
            isStaff={false}
            basePath="/portal/applications"
            districts={districts}
            initial={{ type: "new_registration", channel: "portal", districtId: "", neighbourhood: null, pin: null, addressNote: "", plotNo: "", oldDeedNo: "", govtFileNo: "", houseNo: "", govtReceiptNo: "", plotWidthM: "", plotLengthM: "", }}
          />
        </CardContent>
      </Card>
    </>
  );
}
