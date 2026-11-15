import { cn } from "@dhulka/ui/lib/cn";
import { Banknote, Briefcase, ClipboardCheck, FileCheck2, Landmark, MapPinned, Printer, Receipt, Scale, ShieldCheck, Wallet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { WorkPanel } from "@/lib/server/reports";

const ICON: Record<WorkPanel["panel"], typeof Wallet> = {
  surveyor: MapPinned,
  surveys: ClipboardCheck,
  registration: FileCheck2,
  cashier: Wallet,
  collections: Banknote,
  billing: Receipt,
  valuation: Scale,
  legal: Briefcase,
  accounting: Landmark,
  printing: Printer,
  admin: ShieldCheck,
};

/** Where each count opens. */
const HREF: Record<string, string> = {
  my_zones: "/surveys?tab=zones",
  my_site_checks: "/surveys?tab=assigned",
  my_surveys: "/surveys?tab=assigned",
  zones_open: "/surveys?tab=zones",
  surveys_to_review: "/surveys?tab=submitted",
  site_checks: "/surveys?tab=assigned",
  partial_land: "/parcels?stage=draft",
  ready_to_register: "/parcels?stage=draft",
  changes: "/parcels/changes",
  demolitions: "/demolished?tab=pending",
  owners_draft: "/owners",
  no_certificate: "/documents/print",
  shifts_to_approve: "/collections?tab=reconcile",
  unmatched: "/payments?tab=unmatched",
  runs_open: "/billing/runs",
  not_printed: "/documents/print?tab=print",
  shift_open: "/cashier",
  taken_today: "/cashier",
  houses_owing: "/cashier",
  waiting_approval: "/collections?tab=pos",
  disputed: "/collections?tab=corrections",
  collected_today: "/collections",
  overdue: "/invoices?f=overdue",
  runs_waiting: "/billing/runs",
  exemptions: "/valuation?tab=requests",
  appeals: "/valuation?tab=requests",
  transfers: "/transfers?f=submitted",
  transfer_drafts: "/transfers",
  movements_pending: "/accounting?tab=deposits",
  entries_month: "/accounting?tab=journal",
  print_queue: "/documents/print?tab=print",
  reprints: "/documents/print?tab=reprints",
  invited: "/admin/users?status=invited",
  suspended: "/admin/users?status=suspended",
  active: "/admin/users",
};

/** Which panel comes first for each role: the job the role is for. */
const ROLE_FIRST: Record<string, WorkPanel["panel"]> = {
  surveyor: "surveyor",
  gis_officer: "surveys",
  land_officer: "registration",
  registrar: "registration",
  data_entry_clerk: "registration",
  front_desk_clerk: "registration",
  cashier: "cashier",
  revenue_collector: "cashier",
  collections_officer: "collections",
  finance_manager: "collections",
  billing_officer: "billing",
  valuation_officer: "valuation",
  legal_officer: "legal",
  planning_officer: "legal",
  accountant: "accounting",
  auditor: "accounting",
  print_officer: "printing",
  admin: "admin",
  it_support: "admin",
};

/** Counts no longer shown (Permits, Disputes, Exemptions and Appeals were removed). */
const HIDDEN = new Set(["permits", "disputes", "exemptions", "appeals"]);

/** Counts that are not "waiting" (shown plain, not as work to do). */
const INFO = new Set(["shift_open", "taken_today", "collected_today", "entries_month", "active"]);

/**
 * Dashboard → My work: one panel per job the user does (from their powers, so it follows their role and anything given
 * to them), their own job first. Each count opens the list behind it.
 */
export async function MyWork({ panels, roleKeys, waitingOnly = false }: { panels: WorkPanel[]; roleKeys: string[]; /** Only what waits: no zero or plain-information lines, no job with nothing waiting. */ waitingOnly?: boolean }) {
  const t = await getTranslations("dashboard.work");
  const format = await getFormatter();
  // A panel whose counts were all taken away (e.g. Valuation) is not shown.
  panels = waitingOnly
    ? panels
        .map((p) => ({ ...p, items: p.items.filter((x) => !HIDDEN.has(x.key) && !INFO.has(x.key) && Number(x.n) > 0) }))
        .filter((p) => p.items.length > 0)
    : panels.filter((p) => p.items.some((x) => !HIDDEN.has(x.key)) || p.panel === "accounting");
  if (panels.length === 0) return null;
  const first = roleKeys.map((k) => ROLE_FIRST[k]).filter(Boolean);
  const ordered = [...panels].sort((a, b) => {
    const ia = first.indexOf(a.panel);
    const ib = first.indexOf(b.panel);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <section aria-labelledby="my-work" className="space-y-3">
      <h2 id="my-work" className="font-semibold">
        {t("title")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((p, i) => {
          const Icon = ICON[p.panel];
          const waiting = p.items.filter((x) => !INFO.has(x.key) && !HIDDEN.has(x.key)).reduce((s, x) => s + Number(x.n), 0);
          return (
            <div key={p.panel} className={cn("bg-card rounded-xl border p-4 shadow-xs", i === 0 && "border-primary/40 ring-primary/10 ring-2")}>
              <div className="mb-3 flex items-center gap-2">
                <span className="bg-primary-soft text-primary grid size-8 place-items-center rounded-lg">
                  <Icon className="size-4" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-semibold">{t(`panels.${p.panel}`)}</h3>
                {waiting > 0 ? (
                  <span className="bg-status-pending/10 text-status-pending rounded-full px-2 text-xs font-semibold">{t("waiting", { n: waiting })}</span>
                ) : (
                  <span className="text-muted-foreground text-xs">{t("allDone")}</span>
                )}
              </div>
              <ul className="divide-y text-sm">
                {p.items.filter((x) => !HIDDEN.has(x.key)).map((x) => (
                  <li key={x.key}>
                    <Link href={HREF[x.key] ?? "/dashboard"} className="hover:text-primary flex items-center justify-between gap-3 py-2">
                      <span className="text-muted-foreground">{t(`items.${x.key}`)}</span>
                      <span className={cn("font-semibold tabular-nums", !INFO.has(x.key) && Number(x.n) > 0 && "text-foreground")}>
                        {x.key === "shift_open" ? (Number(x.n) > 0 ? t("open") : t("closed")) : format.number(Number(x.n))}
                        {x.amount !== undefined && Number(x.amount) > 0 && <span className="text-muted-foreground ms-2 text-xs font-normal">{usd(Number(x.amount))}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
                {p.panel === "accounting" && !waitingOnly && (
                  <li className="text-muted-foreground flex justify-between py-2">
                    <span>{t("thisMonth")}</span>
                    <span className="font-semibold">{p.month_open ? t("open") : t("locked")}</span>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
