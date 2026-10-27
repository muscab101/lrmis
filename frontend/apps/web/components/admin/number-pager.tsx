import { cn } from "@dhulka/ui/lib/cn";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** The page numbers around the current one, with the first and last always shown: 1 … 4 5 [6] 7 8 … 40. */
function window(page: number, pages: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  const from = Math.max(2, page - 2);
  const to = Math.min(pages - 1, page + 2);
  out.push(1);
  if (from > 2) out.push("gap");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push("gap");
  if (pages > 1) out.push(pages);
  return out;
}

/** Server-rendered numbered pager: Previous 1 2 3 4 5 … 40 Next, with "Showing 1 to 10 of 400 entries". */
export async function NumberPager({
  page,
  pages,
  total,
  size,
  href,
}: {
  page: number;
  pages: number;
  total: number;
  size: number;
  href: (page: number) => string;
}) {
  const t = await getTranslations("billing");
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  const cell = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2.5 text-sm";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3">
      <span className="text-muted-foreground text-sm">
        {t("table.showing", { first, last, total })}
      </span>
      <nav className="flex flex-wrap items-center gap-1" aria-label={t("table.pages")}>
        {page > 1 ? (
          <Link href={href(page - 1)} className={cn(cell, "hover:bg-muted")}>
            {t("table.previous")}
          </Link>
        ) : (
          <span className={cn(cell, "text-muted-foreground")}>{t("table.previous")}</span>
        )}
        {window(page, pages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="text-muted-foreground px-1">
              …
            </span>
          ) : (
            <Link
              key={p}
              href={href(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(cell, p === page ? "bg-muted border font-medium" : "hover:bg-muted")}
            >
              {p}
            </Link>
          ),
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={cn(cell, "hover:bg-muted")}>
            {t("table.next")}
          </Link>
        ) : (
          <span className={cn(cell, "text-muted-foreground")}>{t("table.next")}</span>
        )}
      </nav>
    </div>
  );
}
