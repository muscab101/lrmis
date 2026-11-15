import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyChecker } from "@/app/[locale]/(public)/verify/verify-checker";
import { VerifyGuide } from "@/app/[locale]/(public)/verify/verify-guide";

/** Citizens: check a certificate or ID card (for example before buying land). */
export default async function PortalVerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("portalBody")} />
      <Card>
        <CardContent className="pt-1 pb-6">
          <VerifyChecker />
        </CardContent>
      </Card>
      <VerifyGuide />
    </div>
  );
}
