import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { getCertificateDesign } from "@/lib/server/certificate-design";
import { DesignEditor } from "./design-editor";

export async function generateMetadata() {
  const t = await getTranslations("certificateDesign");
  return { title: t("title") };
}

/** Admin: how certificates look — colour, titles, watermark, security seals and a footer note. */
export default async function CertificateDesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "certificates.design");
  const t = await getTranslations("certificateDesign");
  const td = await getTranslations("documents");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DesignEditor design={await getCertificateDesign()} defaults={{ titleSo: td("certificateTitleSo"), titleEn: td("certificateTitleEn") }} />
    </>
  );
}
