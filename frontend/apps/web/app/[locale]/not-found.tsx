import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@dhulka/ui/button";
import { EmptyState } from "@dhulka/ui/misc";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-[70dvh] items-center justify-center p-6">
      <EmptyState
        icon={<SearchX />}
        title={t("notFoundTitle")}
        description={t("notFoundBody")}
        action={
          <Button asChild variant="outline">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        }
      />
    </main>
  );
}
