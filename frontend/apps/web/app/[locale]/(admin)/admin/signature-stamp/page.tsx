import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { getCertificateMarks } from "@/lib/server/certificate-marks";
import { MarksEditor } from "./marks-editor";

export async function generateMetadata() {
  const t = await getTranslations("signatureStamp");
  return { title: t("title") };
}

/** Admin: the signature and stamp printed at the bottom of every certificate. */
export default async function SignatureStampPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "certificates.signature");
  const t = await getTranslations("signatureStamp");
  const marks = await getCertificateMarks();
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MarksEditor marks={marks} />
    </>
  );
}
