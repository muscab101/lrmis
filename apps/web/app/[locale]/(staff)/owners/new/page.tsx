import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { NewOwnerForm } from "./new-owner-form";

export default async function NewOwnerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "owners.create");
  const t = await getTranslations("owners");
  const districts = await listDistricts();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("new")} description={t("newSubtitle")} />
      <Card>
        <CardContent>
          <NewOwnerForm districts={districts} />
        </CardContent>
      </Card>
    </div>
  );
}
