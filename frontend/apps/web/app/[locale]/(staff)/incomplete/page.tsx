import { cn } from "@dhulka/ui/lib/cn";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import {
  ArrowRightLeft,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Copy,
  FileStack,
  Gavel,
  Hammer,
  Map as MapIcon,
  MapPin,
  MapPinned,
  MessageSquare,
  Percent,
  Printer,
  Receipt,
  Ruler,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
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
  zones: <MapIcon />,
  places: <MapPin />,
  invoices: <Receipt />,
  certificates: <BadgeCheck />,
  transfers: <ArrowRightLeft />,
  surveys: <Ruler />,
  siteChecks: <CircleHelp />,
  disputes: <Gavel />,
  permits: <Building2 />,
  demolitions: <Hammer />,
  exemptions: <Percent />,
  appeals: <Scale />,
  billingRuns: <FileStack />,
  paymentPlans: <CalendarClock />,
  unmatched: <Banknote />,
  shifts: <Wallet />,
  reprints: <Copy />,
  unprinted: <Printer />,
  campaigns: <MessageSquare />,
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
  const remaining = groups.find((g) => g.key === "places")?.remaining;
  const n = (v: number) => format.number(Number(v));
  const label = (o: { name_so: string; name_en: string }) => (lang === "so" ? o.name_so : o.name_en);

  const statusText = (key: IncompleteGroup["key"], s: string | null) => {
    if (!s) return null;
    const pick = (tr: { has: (k: string) => boolean } & ((k: string) => string), k: string) => (tr.has(k) ? tr(k) : s);
    if (key === "parcels") return pick(tp, `status.${s}`);
    if (key === "invoices") return pick(tb, `invoiceStatus.${s}`);
    if (key === "transfers" || key === "permits") return pick(tl, `status.${s}`);
    if (key === "surveys") return pick(tsv, `status.${s}`);
    if (key === "billingRuns") return pick(tb, `runStatus.${s}`);
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
            <span className="text-primary mb-2 block [&_svg]:size-5">
              {g.count ? ICONS[g.key] : <CheckCircle2 />}
            </span>
            <p className="text-2xl font-semibold tabular-nums">{format.number(g.count)}</p>
            <p className="text-muted-foreground text-xs">{t(`groups.${g.key}`)}</p>
          </a>
        ))}
      </div>

      {remaining && (
        <section id="places" className="bg-card mb-5 scroll-mt-20 rounded-xl border shadow-xs">
          <header className="flex items-center justify-between gap-3 border-b p-4">
            <div className="flex items-center gap-3">
              <span className="text-primary [&_svg]:size-5">{ICONS.places}</span>
              <div>
                <h2 className="font-semibold">{t("remaining.title")}</h2>
                <p className="text-muted-foreground text-xs">{t("remaining.hint")}</p>
              </div>
            </div>
            <Link href="/parcels/yet-to-register?tab=waiting" className="text-primary shrink-0 text-sm hover:underline">
              {t("openList")}
            </Link>
          </header>
          <dl className="grid grid-cols-2 gap-px border-b sm:grid-cols-4">
            {(["total", "registered", "waiting", "remaining"] as const).map((k) => (
              <div key={k} className="p-4">
                <dt className="text-muted-foreground text-xs">{t(`remaining.${k}`)}</dt>
                <dd className={cn("text-2xl font-semibold tabular-nums", k === "remaining" && "text-primary")}>{n(remaining.totals[k])}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground border-b px-4 py-2 text-xs">{t("remaining.notStarted", { count: n(remaining.totals.not_started), all: n(remaining.totals.neighbourhoods) })}</p>
          <div className="grid gap-px lg:grid-cols-2">
            <RemainingTable
              title={t("remaining.byDistrict")}
              nameLabel={t("remaining.district")}
              heads={[t("remaining.total"), t("remaining.registered"), t("remaining.waiting"), t("remaining.remaining")]}
              rows={remaining.districts.map((d) => ({ ...d, name: label(d), sub: null, href: null }))}
              n={n}
            />
            <RemainingTable
              title={t("remaining.started")}
              nameLabel={t("remaining.neighbourhood")}
              heads={[t("remaining.total"), t("remaining.registered"), t("remaining.waiting"), t("remaining.remaining")]}
              rows={remaining.places.map((p) => ({
                ...p,
                name: label(p),
                sub: `${lang === "so" ? p.district_so : p.district_en} · ${p.code}`,
                href: `/parcels?${new URLSearchParams({ stage: p.waiting > 0 ? "draft" : "registered", nbhd: p.id })}`,
              }))}
              n={n}
            />
          </div>
        </section>
      )}

      {total === 0 ? (
        <div className="bg-card text-muted-foreground flex items-center gap-2 rounded-xl border p-5 text-sm">
          <CheckCircle2 className="text-primary size-4" aria-hidden />
          {t("allDone")}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups
            .filter((g) => g.count > 0 && g.key !== "places")
            .map((g) => (
              <section key={g.key} id={g.key} className="bg-card scroll-mt-20 rounded-xl border shadow-xs">
                <header className="flex items-center justify-between gap-3 border-b p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-primary [&_svg]:size-5">{ICONS[g.key]}</span>
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

function RemainingTable({
  title,
  nameLabel,
  heads,
  rows,
  n,
}: {
  title: string;
  nameLabel: string;
  heads: string[];
  rows: { id: string; name: string; sub: string | null; href: string | null; total: number; registered: number; waiting: number; remaining: number }[];
  n: (v: number) => string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="px-4 pt-3 pb-1 text-sm font-medium">{title}</h3>
      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{nameLabel}</TableHead>
              {heads.map((h) => (
                <TableHead key={h} className="text-end">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">
                  {r.href ? (
                    <Link href={r.href} className="hover:text-primary">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                  {r.sub && <span className="text-muted-foreground block text-xs">{r.sub}</span>}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{n(r.total)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{n(r.registered)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{n(r.waiting)}</TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">{n(r.remaining)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
