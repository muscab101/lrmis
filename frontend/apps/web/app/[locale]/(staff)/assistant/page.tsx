import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssistantChat } from "@/components/reports/assistant-chat";
import { requirePermission } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("assistantPage");
  return { title: t("title") };
}

export default async function AssistantPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "reports.assistant");
  const t = await getTranslations("assistantPage");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantChat endpoint="/api/assistant" namespace="assistantPage" />
    </div>
  );
}
