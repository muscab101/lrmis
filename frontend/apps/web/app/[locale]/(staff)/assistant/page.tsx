import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssistantChat } from "@/components/reports/assistant-chat";
import { isAssistantAdmin } from "@/lib/server/assistant";
import { requireStaff } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("assistantPage");
  return { title: t("title") };
}

/** Every staff member gets the help assistant; administrators get the admin one. */
export default async function AssistantPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const admin = await isAssistantAdmin(await createClient(), viewer.user.id, viewer.isSuperAdmin);
  const namespace = admin ? "adminAssistant" : "assistantPage";
  const t = await getTranslations(namespace);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AssistantChat endpoint="/api/assistant" namespace={namespace} />
    </div>
  );
}
