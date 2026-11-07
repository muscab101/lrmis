import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, PageHeader } from "@dhulka/ui/misc";
import { ArrowRight, ClipboardList, Minus, Pencil, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { actionWords, validDay } from "../../words";

interface Work {
  at: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  label: string | null;
  parcel_id: string | null;
  changes: { f: string; from: string | null; to: string | null }[];
}

type Verb = "added" | "changed" | "removed" | "other";
const verbOf = (action: string): Verb =>
  action === "insert"
    ? "added"
    : action === "update"
      ? "changed"
      : action === "delete"
        ? "removed"
        : "other";

const VERB_STYLE: Record<Verb, string> = {
  added: "bg-success/15 text-success",
  changed: "bg-primary/15 text-primary",
  removed: "bg-danger/15 text-danger",
  other: "bg-muted text-muted-foreground",
};
const VERBS = ["added", "changed", "removed", "other"] as const;
const BAR: Record<Verb, string> = {
  added: "bg-success",
  changed: "bg-primary",
  removed: "bg-danger",
  other: "bg-muted-foreground/50",
};
const VERB_ICON = { added: Plus, changed: Pencil, removed: Minus, other: ClipboardList };

// Where each kind of record opens.
const ROUTES: Record<string, string> = {
  parcels: "/parcels",
  invoices: "/invoices",
  parties: "/owners",
  payments: "/payments",
  transfers: "/transfers",
  issued_documents: "/documents",
  demolitions: "/demolished",
  billing_runs: "/billing/runs",
  surveys: "/surveys",
  survey_zones: "/surveys/zones",
};

const UUID = /^[0-9a-f-]{36}$/i;
// Who did it and when is already on the row; ids and inner data say nothing to a reader.
const hidden = (f: string, v: string | null) =>
  /(_by|_id|_ids|^id)$/.test(f) || /^[[{]/.test(v ?? "") || UUID.test(v ?? "");
const words = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export async function generateMetadata() {
  const t = await getTranslations("staffActivity");
  return { title: t("viewWork") };
}

export default async function StaffWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "audit.view");
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("staffActivity");
  const format = await getFormatter();
  const day = validDay((await searchParams).day);
  const supabase = await createClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .eq("user_id", id)
    .eq("kind", "staff")
    .maybeSingle();
  if (!person) notFound();
  const name = person.full_name || person.email || "";
  const { data } = await supabase.rpc("staff_work_done", { p_user: id, p_day: day });
  const work = (data ?? []) as Work[];

  const time = (s: string) => format.dateTime(new Date(s), { timeStyle: "short" });
  const field = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : words(f));
  const value = (f: string, v: string | null) => {
    if (v === null || v === "")
      return <span className="text-muted-foreground italic">{t("empty")}</span>;
    // A stored file: its name means nothing to a reader.
    if (f.endsWith("_path") || /\.(jpe?g|png|webp|pdf|gz)$/i.test(v))
      return f.includes("photo") || f.includes("avatar") ? t("workPhoto") : t("workFile");
    if (/^\d{4}-\d{2}-\d{2}T/.test(v))
      return format.dateTime(new Date(v), { dateStyle: "medium", timeStyle: "short" });
    if (v === "true" || v === "false") return v === "true" ? "✓" : "✗";
    return words(v);
  };
  const noun = (table: string | null) =>
    table && t.has(`tables.${table}`) ? t(`tables.${table}`) : words(table ?? "");
  const href = (w: Work) => {
    const base = w.table_name ? ROUTES[w.table_name] : undefined;
    if (base && w.record_id && UUID.test(w.record_id) && w.action !== "delete")
      return `${base}/${w.record_id}`;
    if (w.parcel_id && UUID.test(w.parcel_id)) return `/parcels/${w.parcel_id}`;
    return null;
  };

  const counts: Record<Verb, number> = { added: 0, changed: 0, removed: 0, other: 0 };
  const byTable = new Map<string, number>();
  for (const w of work) {
    counts[verbOf(w.action)]++;
    if (w.table_name) byTable.set(w.table_name, (byTable.get(w.table_name) ?? 0) + 1);
  }
  const tables = [...byTable].sort((a, b) => b[1] - a[1]);
  const hours: [string, Work[]][] = [];
  for (const w of work) {
    const hour = format.dateTime(new Date(w.at), { hour: "numeric" });
    if (hours.at(-1)?.[0] === hour) hours.at(-1)![1].push(w);
    else hours.push([hour, [w]]);
  }
  const verbLabel: Record<Verb, string> = {
    added: t("workAdded"),
    changed: t("workChanged"),
    removed: t("workRemoved"),
    other: t("workOther"),
  };

  return (
    <>
      <PageHeader title={t("workTitle", { name })} description={t("workSubtitle")}>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <Input
              type="date"
              name="day"
              defaultValue={day ?? ""}
              aria-label={t("day")}
              className="w-44"
            />
            <Button type="submit" variant="outline" size="sm">
              {t("show")}
            </Button>
          </form>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/activity/${id}${day ? `?day=${day}` : ""}`}>{t("timeline")}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/activity">{t("backToList")}</Link>
          </Button>
        </div>
      </PageHeader>

      {work.length === 0 ? (
        <EmptyState icon={<ClipboardList aria-hidden />} title={t("workNone")} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[19rem_1fr]">
          {/* The day at a glance; stays in view while the list scrolls. */}
          <Card className="lg:sticky lg:top-20">
            <CardContent className="space-y-6 p-5">
              <div>
                <p className="text-muted-foreground text-sm">{t("workTotal")}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tabular-nums">{work.length}</span>
                  <span className="text-muted-foreground text-sm">
                    {time(work.at(-1)!.at)} – {time(work[0]!.at)}
                  </span>
                </p>
              </div>

              <div className="space-y-3">
                <div className="bg-muted flex h-2.5 overflow-hidden rounded-full">
                  {VERBS.map((v) =>
                    counts[v] ? (
                      <span
                        key={v}
                        className={BAR[v]}
                        style={{ width: `${(counts[v] / work.length) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-2 text-sm">
                  {VERBS.map((v) => (
                    <li key={v} className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${BAR[v]}`} aria-hidden />
                      <span className="text-muted-foreground">{verbLabel[v]}</span>
                      <span className="ms-auto font-medium tabular-nums">{counts[v]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("workOn")}
                </p>
                <ul className="space-y-2 text-sm">
                  {tables.map(([table, n]) => (
                    <li key={table} className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <span>{noun(table)}</span>
                        <span className="text-muted-foreground tabular-nums">{n}</span>
                      </div>
                      <div className="bg-muted h-1 overflow-hidden rounded-full">
                        <div
                          className="bg-primary/60 h-full rounded-full"
                          style={{ width: `${(n / tables[0]![1]) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Each thing, newest first, on a line through the day, a heading for each hour. */}
          <div className="space-y-8">
            {hours.map(([hour, items]) => (
              <section key={hour}>
                <h2 className="text-muted-foreground mb-3 text-sm font-medium">{hour}</h2>
                <ol className="relative space-y-3 ps-8">
                  <span aria-hidden className="bg-border absolute bottom-2 start-3 top-2 w-px" />
                  {items.map((w, i) => {
                    const verb = verbOf(w.action);
                    const Icon = VERB_ICON[verb];
                    const link = href(w);
                    const changes = w.changes.filter(
                      (c) => !hidden(c.f, c.from) && !hidden(c.f, c.to),
                    );
                    return (
                      <li key={`${w.at}-${i}`} className="relative">
                        <span
                          className={`ring-background absolute -start-8 top-3 grid size-6 place-items-center rounded-full ring-4 ${VERB_STYLE[verb]}`}
                        >
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <Card>
                          <CardContent className="space-y-3 p-4">
                            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                              <p className="min-w-0 flex-1">
                                <span className="font-medium">
                                  {verb === "other"
                                    ? actionWords(t, w.action, w.table_name)
                                    : `${verbLabel[verb]} · ${noun(w.table_name)}`}
                                </span>
                                {w.label && (
                                  <span className="text-muted-foreground ms-2 font-mono text-sm">
                                    {w.label}
                                  </span>
                                )}
                              </p>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {time(w.at)}
                              </span>
                              {link && (
                                <Button asChild variant="ghost" size="sm" className="-my-1 h-7">
                                  <Link href={link}>
                                    {t("workOpen")}
                                    <ArrowRight aria-hidden />
                                  </Link>
                                </Button>
                              )}
                            </div>
                            {changes.length > 0 && (
                              <dl className="bg-muted/50 divide-y rounded-md text-sm">
                                {changes.map((c) => (
                                  <div
                                    key={c.f}
                                    className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]"
                                  >
                                    <dt className="text-muted-foreground">{field(c.f)}</dt>
                                    <dd className="flex flex-wrap items-center gap-2">
                                      <span className="text-muted-foreground line-through">
                                        {value(c.f, c.from)}
                                      </span>
                                      <ArrowRight
                                        className="text-muted-foreground size-3.5"
                                        aria-hidden
                                      />
                                      <span className="font-medium">{value(c.f, c.to)}</span>
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </CardContent>
                        </Card>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
