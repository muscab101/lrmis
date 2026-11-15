import { Card, CardContent } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyChecker } from "@/app/[locale]/(public)/verify/verify-checker";
import { VerifyGuide } from "@/app/[locale]/(public)/verify/verify-guide";
import { requirePermission } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("verify");
  return { title: t("title") };
}

/** Staff: check a certificate or ID card someone shows at the desk (type the code or scan its QR). */
export default async function StaffVerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "verify.view");
  const t = await getTranslations("verify");
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("body")} />
      <Card>
        <CardContent className="pt-1 pb-6">
          <VerifyChecker />
        </CardContent>
      </Card>
      <VerifyGuide />
    </div>
  );
}
