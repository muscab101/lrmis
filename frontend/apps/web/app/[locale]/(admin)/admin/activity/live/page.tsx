import { PageHeader } from "@dhulka/ui/misc";
import { forbidden } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LiveWall } from "@/components/activity/live-wall";
import { requirePermission } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("staffActivity");
  return { title: t("liveTitle") };
}

export default async function LiveScreensPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ u?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "audit.view");
  if (!viewer.isSuperAdmin) forbidden();
  const t = await getTranslations("staffActivity");
  const { u } = await searchParams;
  return (
    <>
      <PageHeader title={t("liveTitle")} description={t("liveSubtitle")} />
      <LiveWall locale={locale} initial={u && /^[0-9a-f-]{36}$/i.test(u) ? u : null} />
    </>
  );
}
