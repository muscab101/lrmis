import { getTranslations } from "next-intl/server";
import { PageLoading } from "@/components/shell/page-loading";

/** Shown while this page loads. */
export default async function Loading() {
  const t = await getTranslations("common");
  return <PageLoading kind="list" label={t("loading")} />;
}
