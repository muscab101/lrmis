import { cn } from "@dhulka/ui/lib/cn";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { ArrowRightLeft, BadgeCheck, Building2, CheckCircle2, CircleHelp, Gavel, MapPinned, Receipt, Ruler, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { incompleteWork, type IncompleteGroup } from "@/lib/server/incomplete";

export async function generateMetadata() {
  const t = await getTranslations("incomplete");
  return { title: t("title") };
}

const ICONS: Record<IncompleteGroup["key"], React.ReactNode> = {
  owners: <Users />,
  parcels: <MapPinned />,
  invoices: <Receipt />,
  certificates: <BadgeCheck />,
  transfers: <ArrowRightLeft />,
  surveys: <Ruler />,
  siteChecks: <CircleHelp />,
  disputes: <Gavel />,
  permits: <Building2 />,
};

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
  const groups = (await incompleteWork(viewer, lang)).sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
  const total = groups.reduce((s, g) => s + g.count, 0);

  const statusText = (key: IncompleteGroup["key"], s: string | null) => {
    if (!s) return null;
    const pick = (tr: { has: (k: string) => boolean } & ((k: string) => string), k: string) => (tr.has(k) ? tr(k) : s);
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

      {/* Overview: one tile per group, jumping to it below. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {groups.map((g) => (
          <a
            key={g.key}
            href={`#${g.key}`}
            className={cn("bg-card hover:border-primary/40 rounded-xl border p-3 shadow-xs transition-colors", g.count === 0 && "opacity-60")}
          >
            <span className={cn("mb-2 grid size-8 place-items-center rounded-lg [&_svg]:size-4", g.count ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
              {g.count ? ICONS[g.key] : <CheckCircle2 />}
            </span>
            <p className="text-2xl font-semibold tabular-nums">{format.number(g.count)}</p>
            <p className="text-muted-foreground text-xs">{t(`groups.${g.key}`)}</p>
          </a>
        ))}
      </div>

      {total === 0 ? (
        <div className="bg-card text-muted-foreground flex items-center gap-2 rounded-xl border p-5 text-sm">
          <CheckCircle2 className="text-success size-4" aria-hidden />
          {t("allDone")}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups
            .filter((g) => g.count > 0)
            .map((g) => (
              <section key={g.key} id={g.key} className="bg-card scroll-mt-20 rounded-xl border shadow-xs">
                <header className="flex items-center justify-between gap-3 border-b p-4">
                  <div className="flex items-center gap-3">
                    <span className="bg-warning/10 text-warning grid size-8 place-items-center rounded-lg [&_svg]:size-4">{ICONS[g.key]}</span>
                    <div>
                      <h2 className="font-semibold">
                        {t(`groups.${g.key}`)} <span className="text-muted-foreground font-normal">({format.number(g.count)})</span>
                      </h2>
                      <p className="text-muted-foreground text-xs">{t(`hints.${g.key}`)}</p>
                    </div>
                  </div>
                  <Link href={g.href} className="text-primary shrink-0 text-sm hover:underline">
                    {t("openList")}
                  </Link>
                </header>
                <ul className="divide-y">
                  {g.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={r.href} className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0">
                          <Mono className="block truncate">{r.title}</Mono>
                          {r.detail && <span className="text-muted-foreground block truncate text-xs">{r.detail}</span>}
                        </span>
                        <span className="shrink-0 text-end">
                          {r.amount != null && <span className="block font-medium tabular-nums">{usd(r.amount)}</span>}
                          {statusText(g.key, r.status) && <span className="bg-muted inline-block rounded-full px-2 py-0.5 text-[11px]">{statusText(g.key, r.status)}</span>}
                          {r.at && <span className="text-muted-foreground block text-[11px]">{format.dateTime(new Date(r.at), { dateStyle: "medium" })}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {g.count > g.rows.length && (
                  <p className="text-muted-foreground border-t px-4 py-2 text-xs">{t("andMore", { count: g.count - g.rows.length })}</p>
                )}
              </section>
            ))}
        </div>
      )}
    </>
  );
}
