import { Mono, PageHeader } from "@dhulka/ui/misc";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { incompleteWork, type IncompleteGroup } from "@/lib/server/incomplete";

export async function generateMetadata() {
  const t = await getTranslations("incomplete");
  return { title: t("title") };
}

/** Every piece of work still unfinished, grouped, with links to finish it. */
export default async function IncompletePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "dashboard.view");
  const t = await getTranslations("incomplete");
  const tp = await getTranslations("parcels");
  const tb = await getTranslations("billing");
  const tl = await getTranslations("legal");
  const tsv = await getTranslations("surveys");
  const format = await getFormatter();
  const lang = await getLocale();
  const groups = (await incompleteWork(viewer, lang)).sort(
    (a, b) => Number(b.count > 0) - Number(a.count > 0),
  );
  const total = groups.reduce((s, g) => s + g.count, 0);

  const statusText = (key: IncompleteGroup["key"], s: string | null) => {
    if (!s) return null;
    const pick = (tr: { has: (k: string) => boolean } & ((k: string) => string), k: string) =>
      tr.has(k) ? tr(k) : s;
    if (key === "parcels") return pick(tp, `status.${s}`);
    if (key === "invoices") return pick(tb, `invoiceStatus.${s}`);
    if (key === "transfers" || key === "permits") return pick(tl, `status.${s}`);
    if (key === "surveys") return pick(tsv, `status.${s}`);
    return s;
  };
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* Overview: what kind of work, how many are waiting, and what to do next. Ink and blue only. */}
      <div className="bg-card mb-6 overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-start text-xs">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("colWork")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("colWaiting")}</th>
              <th className="hidden px-4 py-2 text-start font-medium md:table-cell">
                {t("colNext")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {groups.map((g) => (
              <tr key={g.key} className={g.count ? "" : "text-muted-foreground"}>
                <td className="px-4 py-2">
                  {g.count ? (
                    <a href={`#${g.key}`} className="hover:underline">
                      {t(`groups.${g.key}`)}
                    </a>
                  ) : (
                    t(`groups.${g.key}`)
                  )}
                </td>
                <td
                  className={`px-4 py-2 text-end tabular-nums ${g.count ? "text-primary font-semibold" : ""}`}
                >
                  {g.count ? format.number(g.count) : t("none")}
                </td>
                <td className="text-muted-foreground hidden px-4 py-2 md:table-cell">
                  {g.count ? t(`hints.${g.key}`) : t("nothingToDo")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground text-sm">{t("allDone")}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups
            .filter((g) => g.count > 0)
            .map((g) => (
              <section key={g.key} id={g.key} className="bg-card scroll-mt-20 rounded-md border">
                <header className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <h2 className="font-semibold">
                      {t(`groups.${g.key}`)}{" "}
                      <span className="text-primary tabular-nums">{format.number(g.count)}</span>
                    </h2>
                    <p className="text-muted-foreground text-xs">{t(`hints.${g.key}`)}</p>
                  </div>
                  <Link href={g.href} className="text-primary shrink-0 text-sm hover:underline">
                    {t("openList")}
                  </Link>
                </header>
                <ul className="divide-y">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={r.href}
                        className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <Mono className="block truncate">{r.title}</Mono>
                          {r.detail && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {r.detail}
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-end text-xs">
                          {r.amount != null && (
                            <span className="text-foreground block text-sm tabular-nums">
                              {usd(r.amount)}
                            </span>
                          )}
                          {[
                            statusText(g.key, r.status),
                            r.at &&
                              t(`when.${g.key}`, {
                                date: format.dateTime(new Date(r.at), { dateStyle: "medium" }),
                              }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {g.count > g.rows.length && (
                  <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                    {t("andMore", { count: g.count - g.rows.length })}
                  </p>
                )}
              </section>
            ))}
        </div>
      )}
    </>
  );
}
