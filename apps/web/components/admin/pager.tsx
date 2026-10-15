import { Button } from "@dhulka/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Server-rendered pager: the page number lives in the URL. */
export async function Pager({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  const t = await getTranslations("common");
  return (
    <div className="flex items-center justify-between border-t p-3 text-sm">
      <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
          {page > 1 ? (
            <Link href={href(page - 1)}>
              <ChevronLeft className="rtl:rotate-180" aria-hidden />
              {t("previous")}
            </Link>
          ) : (
            <span>
              <ChevronLeft aria-hidden />
              {t("previous")}
            </span>
          )}
        </Button>
        <Button variant="outline" size="sm" asChild={page < pages} disabled={page >= pages}>
          {page < pages ? (
            <Link href={href(page + 1)}>
              {t("next")}
              <ChevronRight className="rtl:rotate-180" aria-hidden />
            </Link>
          ) : (
            <span>
              {t("next")}
              <ChevronRight aria-hidden />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
