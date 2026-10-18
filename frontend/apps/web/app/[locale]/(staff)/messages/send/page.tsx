import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SingleSms } from "@/components/messages/single-sms";
import { requirePermission } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("messages");
  return { title: t("singleSmsTitle") };
}

export default async function SingleSmsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "messages.create");
  const t = await getTranslations("messages");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("singleSmsTitle")} description={t("singleSmsSubtitle")} />
      <SingleSms />
    </div>
  );
}
