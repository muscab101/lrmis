import { ShieldX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@dhulka/ui/button";
import { EmptyState } from "@dhulka/ui/misc";
import { Link } from "@/i18n/navigation";

export default async function Forbidden() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-[70dvh] items-center justify-center p-6">
      <EmptyState
        icon={<ShieldX />}
        title={t("forbiddenTitle")}
        description={t("forbiddenBody")}
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">{t("backToDashboard")}</Link>
          </Button>
        }
      />
    </main>
  );
}
