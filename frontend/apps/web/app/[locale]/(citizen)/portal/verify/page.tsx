import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyChecker } from "@/app/[locale]/(public)/verify/verify-checker";
import { VerifyGuide } from "@/app/[locale]/(public)/verify/verify-guide";
import { notFound } from "next/navigation";
import { requireCitizen } from "@/lib/server/auth";

/** Citizens: check a certificate or ID card (for example before buying land). */
export default async function PortalVerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Admin → Roles → Citizen → Verify: without it the page is not there for citizens.
  if (!(await requireCitizen(locale)).can("verify.view")) notFound();
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
