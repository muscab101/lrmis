import { Card } from "@dhulka/ui/card";
import { cn } from "@dhulka/ui/lib/cn";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import {
  ArrowRightLeft,
  BadgeCheck,
  Banknote,
  Calculator,
  CalendarClock,
  Clock,
  HandCoins,
  Inbox,
  Landmark,
  Percent,
  FileSpreadsheet,
  Store,
  type LucideIcon,
  PencilLine,
  Printer,
  Receipt,
  ReceiptText,
  Undo2,
  UserCheck,
  Wallet,
} from "lucide-react";
import { forbidden } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { ApprovalActions } from "@/components/approvals/approval-actions";
import { DistrictSelect } from "@/components/approvals/district-select";
import { segClass, segGroupClass } from "@/components/shell/tabs";

/** A tab here: the app's blue when chosen. */
const tabClass = (active: boolean) => cn(segClass(active), active && "bg-primary text-primary-foreground");
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/server/auth";
import {
  APPROVAL_GROUPS,
  APPROVAL_KINDS,
  APPROVAL_PERMISSIONS,
  APPROVE_ONLY,
  type ApprovalGroup,
  type ApprovalItem,
  type ApprovalKind,
  canApproveOwn,
  listApprovals,
  OPEN_ONLY,
  SECOND_PERSON,
} from "@/lib/server/approvals";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("approvals");
  return { title: t("title") };
}

/** Each part of the system's icon (plain: no colours). */
const GROUP_ICON: Record<ApprovalGroup, LucideIcon> = {
  transfers: ArrowRightLeft,
  certificates: BadgeCheck,
  accounting: Banknote,
};

const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  transfer: ArrowRightLeft,
  certificate_issue: BadgeCheck,
  reprint: Printer,
  credit_note: ReceiptText,
  payment_plan: CalendarClock,
  billing_run: Receipt,
  payment_correction: PencilLine,
  reversal: Undo2,
  shift: Wallet,
  commission_payout: HandCoins,
  cashier_recon: Calculator,
  movement: Landmark,
  commission_rule: Percent,
  recon_batch: FileSpreadsheet,
  pos_payments: Store,
  payment: Banknote,
};

const DAY = 86_400_000;
/** Over a week is late (shown in bold). */
const LATE_DAYS = 7;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Applications: everything waiting for this person's approval, in one place, by part of the system. */
export default async function ApplicationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  if (!APPROVAL_PERMISSIONS.some((p) => viewer.can(p))) forbidden();
  const t = await getTranslations("approvals");
  const format = await getFormatter();
  const sp = await searchParams;
  const [all, approveOwn] = await Promise.all([listApprovals(), canApproveOwn(viewer.user.id, viewer.isSuperAdmin)]);
  const now = Date.now();
  const days = (i: ApprovalItem) => (i.at ? Math.max(0, Math.floor((now - new Date(i.at).getTime()) / DAY)) : 0);

  const lang = await getLocale();
  const placeName = (d: { name_so: string; name_en: string }) => (lang === "so" ? d.name_so : d.name_en);
  // Each district works its own: the districts that have something waiting, and the one chosen.
  const districts = [...new Map(all.filter((i) => i.district).map((i) => [i.district!.code, i.district!])).values()].sort((a, b) =>
    placeName(a).localeCompare(placeName(b)),
  );
  const district = districts.find((d) => d.code === sp.d)?.code ?? null;
  const items = district ? all.filter((i) => i.district?.code === district) : all;

  const group = (APPROVAL_GROUPS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as ApprovalGroup) : null;
  const inGroup = (g: ApprovalGroup) => items.filter((i) => APPROVAL_KINDS[i.kind] === g);
  const shown = group ? inGroup(group) : items;
  // Oldest first: what has waited longest is decided first.
  const rows = [...shown].sort((a, b) => days(b) - days(a));
  const late = items.filter((i) => days(i) >= LATE_DAYS).length;
  const mine = items.filter((i) => i.mine).length;
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const href = (g: ApprovalGroup | null, d: string | null = district) => {
    const q = new URLSearchParams();
    if (g) q.set("tab", g);
    if (d) q.set("d", d);
    return `/applications${q.size ? `?${q}` : ""}`;
  };
  /** One fact, written for people: money as dollars, dates as dates. */
  const factValue = (key: string, v: string | number) =>
    key.endsWith("_usd") ? usd(Number(v)) : key.endsWith("_date") ? format.dateTime(new Date(String(v)), { dateStyle: "medium" }) : String(v);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <KpiChip label={t("kpiWaiting")} value={format.number(items.length)} />
          <KpiChip label={t("kpiLate", { days: LATE_DAYS })} value={format.number(late)} />
          <KpiChip label={t("kpiMine")} value={format.number(mine)} />
        </div>
      </PageHeader>

      {/* One tab per part of the system (same look as the type tabs): what waits there; the oldest shows on hover. */}
      <nav className={cn(segGroupClass, "mb-4 max-w-full overflow-x-auto")} aria-label={t("title")}>
        <Link href={href(null)} className={tabClass(group === null)} aria-current={group === null ? "page" : undefined}>
          {t("groups.all")}
          <span className="opacity-70 tabular-nums">{items.length}</span>
        </Link>
        {APPROVAL_GROUPS.map((g) => {
          const list = inGroup(g);
          const Icon = GROUP_ICON[g];
          const oldest = list.reduce((m, i) => Math.max(m, days(i)), 0);
          return (
            <Link
              key={g}
              href={href(g)}
              aria-current={group === g ? "page" : undefined}
              title={list.length === 0 ? t("tileNone") : t("tileOldest", { days: oldest })}
              className={tabClass(group === g)}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(`groups.${g}`)}
              <span className="opacity-70 tabular-nums">{list.length}</span>
            </Link>
          );
        })}
      </nav>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{group ? t(`groups.${group}`) : t("groups.all")}</h2>
            <p className="text-muted-foreground text-xs">{t("listCount", { count: rows.length })}</p>
          </div>
          {districts.length > 1 && (
            <DistrictSelect
              value={district}
              label={t("district")}
              allLabel={t("allDistricts")}
              options={districts.map((d) => ({
                code: d.code,
                name: placeName(d),
                count: all.filter((i) => i.district?.code === d.code && (!group || APPROVAL_KINDS[i.kind] === group)).length,
              }))}
              hrefFor={Object.fromEntries([["", href(group, null)], ...districts.map((d) => [d.code, href(group, d.code)])])}
            />
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <ul className="divide-y">
            {rows.map((i) => {
              const Icon = KIND_ICON[i.kind];
              const age = days(i);
              return (
                <li key={`${i.kind}-${i.id}-${i.extra?.cashier ?? ""}-${i.extra?.district ?? ""}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors sm:flex-nowrap">
                  <span className="text-primary grid size-8 shrink-0 place-items-center" aria-hidden>
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold">{t(`kinds.${i.kind}`)}</span>
                      {i.district && <span className="text-muted-foreground text-xs">· {placeName(i.district)}</span>}
                      {i.ref && (
                        <Link href={i.href} className="hover:text-primary text-muted-foreground text-xs">
                          <Mono>{i.ref}</Mono>
                        </Link>
                      )}
                    </div>
                    <p className="truncate text-sm">{i.title || "—"}</p>
                    {i.detail && <p className="text-muted-foreground truncate text-xs">{i.detail}</p>}
                    {i.facts && Object.keys(i.facts).length > 0 && (
                      <dl className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                        {Object.entries(i.facts).map(([k, v]) => (
                          <div key={k} className="flex gap-1">
                            <dt>{t.has(`facts.${k}`) ? t(`facts.${k}`) : k}:</dt>
                            <dd className="text-foreground font-medium">{t.has(`values.${v}`) ? t(`values.${v}`) : factValue(k, v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  {i.amount != null && <span className="shrink-0 text-sm font-semibold tabular-nums">{usd(i.amount)}</span>}
                  <div className="hidden w-40 shrink-0 items-center gap-2 md:flex">
                    {i.by ? (
                      <>
                        <span className="text-primary border-primary/30 grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold">{initials(i.by)}</span>
                        <span className="min-w-0 truncate text-xs">
                          {i.by}
                          {i.mine && <span className="text-muted-foreground"> · {t("you")}</span>}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t("bySystem")}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap",
                      age >= LATE_DAYS ? "text-primary font-semibold" : "text-muted-foreground",
                    )}
                    title={i.at ? format.dateTime(new Date(i.at), { dateStyle: "medium", timeStyle: "short" }) : undefined}
                  >
                    <Clock className="size-3" aria-hidden />
                    {age === 0 ? t("today") : t("daysAgo", { days: age })}
                  </span>
                  <div className="shrink-0">
                    {i.mine && !approveOwn && SECOND_PERSON.includes(i.kind) ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs whitespace-nowrap">
                        <UserCheck className="size-3.5" aria-hidden />
                        {t("needsSomeoneElse")}
                      </span>
                    ) : (
                    <ApprovalActions
                      kind={i.kind}
                      id={i.id}
                      extra={i.extra ?? null}
                      href={i.href}
                      label={`${t(`kinds.${i.kind}`)} ${i.ref ?? ""}`.trim()}
                      canApprove={!OPEN_ONLY.includes(i.kind)}
                      canReject={!OPEN_ONLY.includes(i.kind) && !APPROVE_ONLY.includes(i.kind)}
                    />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
