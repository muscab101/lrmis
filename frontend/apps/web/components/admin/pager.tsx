import { Button } from "@dhulka/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Server-rendered pager: the page number lives in the URL. Arrow and word stay on one line, also when greyed out. */
export async function Pager({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  const t = await getTranslations("common");
  const prev = (
    <>
      <ChevronLeft className="rtl:rotate-180" aria-hidden />
      {t("previous")}
    </>
  );
  const next = (
    <>
      {t("next")}
      <ChevronRight className="rtl:rotate-180" aria-hidden />
    </>
  );
  return (
    <div className="flex items-center justify-between gap-3 border-t p-3 text-sm">
      <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" className="whitespace-nowrap" asChild>
            <Link href={href(page - 1)}>{prev}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="whitespace-nowrap" disabled>
            {prev}
          </Button>
        )}
        {page < pages ? (
          <Button variant="outline" size="sm" className="whitespace-nowrap" asChild>
            <Link href={href(page + 1)}>{next}</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="whitespace-nowrap" disabled>
            {next}
          </Button>
        )}
      </div>
    </div>
  );
}
