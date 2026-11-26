import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Compose } from "@/components/messages/compose";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { composeTemplates } from "@/lib/server/messages";

export async function generateMetadata() {
  const t = await getTranslations("messages.compose");
  return { title: t("title") };
}

/** Write a message to chosen owners or to all owners in chosen areas. */
export default async function ComposePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "messages.create");
  const t = await getTranslations("messages.compose");
  const templates = await composeTemplates();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/messages" className="hover:underline">
            {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("subtitle")}
      />
      <Compose templates={templates} />
    </>
  );
}
