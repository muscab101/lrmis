import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssistantChat } from "@/components/reports/assistant-chat";

export default async function PortalAssistantPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portalAssistant");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantChat endpoint="/api/assistant/citizen" namespace="portalAssistant" />
    </div>
  );
}
