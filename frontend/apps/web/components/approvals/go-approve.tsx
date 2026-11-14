import { Button } from "@dhulka/ui/button";
import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Where an approve button used to be: approvals happen only on the Applications page now, so this opens it (on the
 * right part, and on the item's district when given).
 */
export function GoApprove({ tab, size = "sm", iconOnly = false }: { tab: "transfers" | "certificates" | "accounting"; size?: "sm" | "default"; iconOnly?: boolean }) {
  const t = useTranslations("approvals");
  if (iconOnly) {
    return (
      <Button asChild variant="ghost" size="icon-sm" title={t("goApprove")}>
        <Link href={`/applications?tab=${tab}`} aria-label={t("goApprove")}>
          <Inbox aria-hidden />
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size={size}>
      <Link href={`/applications?tab=${tab}`}>
        <Inbox aria-hidden />
        {t("goApprove")}
      </Link>
    </Button>
  );
}
