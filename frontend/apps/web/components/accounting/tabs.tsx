import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { cn } from "@dhulka/ui/lib/cn";
import { Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowDownLeft, ArrowUpRight, Building2, Landmark, PiggyBank, Scale } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AssetActions, AssetButton, DepreciateButton } from "@/components/accounting/asset-forms";
import {
  PayoutButton,
  PayoutDecide,
  RuleActions,
  RuleButton,
  type FeeTypeLite,
} from "@/components/accounting/commission-forms";
import {
  MovementActions,
  MovementButton,
  type Acct,
  type Dist,
  type Kind,
} from "@/components/accounting/movement-forms";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { Link } from "@/i18n/navigation";
import type { Viewer } from "@/lib/server/auth";
import {
  commissionSummary,
  generalLedger,
  listCommissionRules,
  listPayouts,
} from "@/lib/server/finance";
import { createClient } from "@/lib/supabase/server";
import {
  accountingDistricts,
  accountingOverview,
  listAssets,
  listMovements,
  type MovementStatus,
} from "@/lib/server/accounting";

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "pending",
  confirmed: "approved",
  rejected: "rejected",
  cancelled: "draft",
  active: "approved",
  disposed: "draft",
};
const CHANNEL_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-1)",
];

async function tools() {
  const [t, format, lang] = await Promise.all([
    getTranslations("accounting"),
    getFormatter(),
    getLocale(),
  ]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const name = (o: { name_so: string; name_en: string } | null | undefined) =>
    o ? (lang === "so" ? o.name_so : o.name_en) : "—";
  const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { dateStyle: "medium" });
  return { t, format, lang, usd, name, day };
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card shadow-xs rounded-xl border p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone: "primary" | "accent" | "warning" | "flag";
}) {
  const toneClass = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning/10 text-warning",
    flag: "bg-flag/10 text-flag",
  }[tone];
  return (
    <div className="bg-card shadow-xs rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
            toneClass,
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>}
    </div>
  );
}

/** Money in and out for the period, what the office holds, what waits for confirmation, the assets. */
export async function OverviewTab({ from, to }: { from: string; to: string }) {
  const { t, usd, name } = await tools();
  const o = await accountingOverview(from, to);
  const moneyIn = Number(o.collected) + Number(o.other_in);
  const moneyOut = Number(o.money_out);
  const bal = (code: string) => Number(o.balances.find((b) => b.code === code)?.balance ?? 0);
  const moneyAccounts = o.balances.filter((b) => b.type === "asset" && /^11\d\d$/.test(b.code));
  const held = moneyAccounts.filter((b) => !b.is_bank).reduce((s, b) => s + Number(b.balance), 0);
  const inBank = moneyAccounts.filter((b) => b.is_bank).reduce((s, b) => s + Number(b.balance), 0);
  const channelTotal = o.by_channel.reduce((s, c) => s + Number(c.amount), 0);
  const outTotal = o.expense_by_account.reduce((s, c) => s + Number(c.amount), 0);
  const pending = (["deposit", "expense", "income"] as Kind[]).filter((k) => o.pending[k]?.count);
  const surplus = Number(o.income) - Number(o.expenses);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t("overview.moneyIn")}
          value={usd(moneyIn)}
          hint={t("overview.moneyInHint", { collected: usd(o.collected), other: usd(o.other_in) })}
          icon={<ArrowDownLeft />}
          tone="primary"
        />
        <Tile
          label={t("overview.moneyOut")}
          value={usd(moneyOut)}
          hint={t("overview.moneyOutHint")}
          icon={<ArrowUpRight />}
          tone="flag"
        />
        <Tile
          label={t("overview.net")}
          value={usd(moneyIn - moneyOut)}
          hint={t("overview.netHint", { amount: usd(surplus) })}
          icon={<Scale />}
          tone="accent"
        />
        <Tile
          label={t("overview.deposited")}
          value={usd(o.deposited)}
          hint={t("overview.depositedHint", { amount: usd(held) })}
          icon={<Landmark />}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={t("overview.inOutTitle")}>
          <TrendChart
            series={o.series.map((p) => ({
              day: p.day,
              collected: Number(p.in),
              billed: Number(p.out),
            }))}
            labels={{ collected: t("overview.moneyIn"), billed: t("overview.moneyOut") }}
          />
        </Panel>
        <Panel title={t("overview.holdingsTitle")}>
          <ul className="divide-y text-sm">
            {moneyAccounts.map((b) => (
              <li key={b.code} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  <Mono className="text-muted-foreground me-1.5 text-xs">{b.code}</Mono>
                  {name(b)}
                  {b.is_bank && <span className="text-primary ms-1.5 text-xs">{t("bank")}</span>}
                </span>
                <span className="font-medium tabular-nums">{usd(b.balance)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 py-2 font-semibold">
              <span>{t("overview.totalMoney")}</span>
              <span className="tabular-nums">{usd(held + inBank)}</span>
            </li>
          </ul>
          <dl className="bg-muted/40 mt-3 grid grid-cols-2 gap-2 rounded-lg p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">{t("overview.debtors")}</dt>
              <dd className="font-semibold tabular-nums">{usd(bal("1200"))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("overview.customerCredit")}</dt>
              <dd className="font-semibold tabular-nums">{usd(bal("2100"))}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("overview.byChannel")}>
          {o.by_channel.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("overview.nothing")}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {o.by_channel.map((c, i) => (
                <li key={c.channel}>
                  <div className="flex justify-between gap-3">
                    <span>{t(`channels.${c.channel}`)}</span>
                    <span className="font-medium tabular-nums">{usd(c.amount)}</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${channelTotal ? (Number(c.amount) / channelTotal) * 100 : 0}%`,
                        background: CHANNEL_COLORS[i],
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={t("overview.outByAccount")}
          action={
            <Link href="/accounting?tab=cashbook" className="text-primary text-sm hover:underline">
              {t("overview.open")}
            </Link>
          }
        >
          {o.expense_by_account.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("overview.nothing")}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {o.expense_by_account.map((c) => (
                <li key={c.code}>
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{name(c)}</span>
                    <span className="font-medium tabular-nums">{usd(c.amount)}</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-flag h-full rounded-full"
                      style={{ width: `${outTotal ? (Number(c.amount) / outTotal) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title={t("overview.waiting")}>
            {pending.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("overview.nothingWaiting")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {pending.map((k) => (
                  <li key={k}>
                    <Link
                      href={`/accounting?tab=${k === "deposit" ? "deposits" : "cashbook"}&status=pending`}
                      className="hover:bg-muted/50 -mx-2 flex justify-between gap-3 rounded-md px-2 py-2"
                    >
                      <span>{t(`overview.pending.${k}`, { count: o.pending[k]!.count })}</span>
                      <span className="font-medium tabular-nums">{usd(o.pending[k]!.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel
            title={t("overview.assetsTitle")}
            action={
              <Link href="/accounting?tab=assets" className="text-primary text-sm hover:underline">
                {t("overview.open")}
              </Link>
            }
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tabular-nums">{usd(o.assets.book_value)}</p>
                <p className="text-muted-foreground text-xs">
                  {t("overview.assetsHint", { count: o.assets.count, cost: usd(o.assets.cost) })}
                </p>
              </div>
              <Building2 className="text-muted-foreground size-6" aria-hidden />
            </div>
            {o.assets.due > 0 && (
              <p className="text-warning mt-2 text-xs">
                {t("overview.depreciationDue", { count: o.assets.due })}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Collections district by district, with a deposit button for what each district still holds. */
export async function DistrictsTab({
  from,
  to,
  viewer,
  accounts,
  districts,
}: {
  from: string;
  to: string;
  viewer: Viewer;
  accounts: Acct[];
  districts: Dist[];
}) {
  const { t, usd, name } = await tools();
  const rows = await accountingDistricts(from, to);
  const sum = (
    k: "billed" | "collected" | "cash" | "mobile" | "card" | "bank" | "deposited" | "held" | "owed",
  ) => rows.reduce((s, r) => s + r[k], 0);
  const canDeposit = viewer.can("accounting.create");
  const cols = [
    "billed",
    "collected",
    "cash",
    "mobile",
    "card",
    "bank",
    "deposited",
    "held",
    "owed",
  ] as const;
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground px-1 text-sm">{t("districts.help")}</p>
      <div className="bg-card overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("district")}</TableHead>
              {cols.map((c) => (
                <TableHead key={c} className="whitespace-nowrap text-end">
                  {t(`districts.cols.${c}`)}
                </TableHead>
              ))}
              {canDeposit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.district_id}
                className={r.collected + r.held + r.owed === 0 ? "text-muted-foreground" : ""}
              >
                <TableCell className="whitespace-nowrap text-sm font-medium">{name(r)}</TableCell>
                {cols.map((c) => (
                  <TableCell
                    key={c}
                    className={cn(
                      "text-end text-sm tabular-nums",
                      c === "collected" && "font-semibold",
                      c === "held" && r.held > 0 && "text-warning font-semibold",
                    )}
                  >
                    {usd(r[c])}
                  </TableCell>
                ))}
                {canDeposit && (
                  <TableCell className="text-end">
                    {r.held > 0 && (
                      <MovementButton
                        kind="deposit"
                        accounts={accounts}
                        districts={districts}
                        districtId={r.district_id}
                        held={r.held_accounts}
                        variant="outline"
                        label={t("districts.deposit")}
                      />
                    )}
                    {r.pending_deposits > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("districts.pendingDeposit", { amount: usd(r.pending_deposits) })}
                      </p>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">{t("totals2")}</TableCell>
              {cols.map((c) => (
                <TableCell key={c} className="text-end text-sm font-semibold tabular-nums">
                  {usd(sum(c))}
                </TableCell>
              ))}
              {canDeposit && <TableCell />}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const STATUSES: MovementStatus[] = ["pending", "confirmed", "rejected", "cancelled"];

/** Deposits, or money in & out: filter by status, record, confirm, reject, cancel, delete. */
export async function MovementsTab({
  tab,
  status,
  viewer,
  accounts,
  districts,
}: {
  tab: "deposits" | "cashbook";
  status: MovementStatus | null;
  viewer: Viewer;
  accounts: Acct[];
  districts: Dist[];
}) {
  const { t, usd, name, day } = await tools();
  const kinds: Kind[] = tab === "deposits" ? ["deposit"] : ["expense", "income"];
  const rows = await listMovements(kinds, status);
  const acct = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? name(a) : code;
  };
  const can = {
    edit: viewer.can("accounting.create"),
    approve: viewer.can("accounting.approve"),
    cancel: viewer.can("accounting.cancel"),
    delete: viewer.can("accounting.delete"),
  };
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const totalIn = confirmed.filter((r) => r.kind !== "expense").reduce((s, r) => s + r.amount, 0);
  const totalOut = confirmed.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 text-sm">
        {[null, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/accounting?tab=${tab}${s ? `&status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-3 py-1",
              status === s ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted",
            )}
          >
            {s ? t(`movement.status.${s}`) : t("movement.all")}
          </Link>
        ))}
        {can.edit && (
          <span className="ms-auto flex flex-wrap gap-2">
            {tab === "deposits" ? (
              <MovementButton kind="deposit" accounts={accounts} districts={districts} />
            ) : (
              <>
                <MovementButton
                  kind="income"
                  accounts={accounts}
                  districts={districts}
                  variant="outline"
                />
                <MovementButton kind="expense" accounts={accounts} districts={districts} />
              </>
            )}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-6 text-center text-sm">
          {t(`movement.empty.${tab}`)}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("movement.number")}</TableHead>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("district")}</TableHead>
              <TableHead>{tab === "deposits" ? t("movement.fromTo") : t("account")}</TableHead>
              <TableHead>
                {tab === "deposits" ? t("movement.party.deposit") : t("movement.partyCol")}
              </TableHead>
              <TableHead className="text-end">{t("movement.amount")}</TableHead>
              <TableHead>{t("statusLabel")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const out = r.kind === "expense";
              return (
                <TableRow
                  key={r.id}
                  className={
                    r.status === "cancelled" || r.status === "rejected"
                      ? "text-muted-foreground"
                      : ""
                  }
                >
                  <TableCell>
                    <Mono className="text-xs">{r.number}</Mono>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {day(r.movement_date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.district ? name(r.district) : t("movement.wholeOffice")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.kind === "deposit"
                      ? `${acct(r.credit_account)} → ${acct(r.debit_account)}`
                      : out
                        ? acct(r.debit_account)
                        : acct(r.credit_account)}
                    {r.kind !== "deposit" && (
                      <span className="text-muted-foreground block text-xs">
                        {out
                          ? t("movement.paidFrom", { account: acct(r.credit_account) })
                          : t("movement.paidInto", { account: acct(r.debit_account) })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.party ?? "—"}
                    {r.reference && (
                      <span className="text-muted-foreground block text-xs">{r.reference}</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap text-end text-sm font-medium tabular-nums",
                      tab === "cashbook" && (out ? "text-danger" : "text-success"),
                    )}
                  >
                    {tab === "cashbook" ? (out ? "− " : "+ ") : ""}
                    {usd(r.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[r.status] ?? "draft"}>
                      {t(`movement.status.${r.status}`)}
                    </StatusBadge>
                    {(r.decision_note || r.cancel_reason) && (
                      <span className="text-muted-foreground mt-1 block max-w-48 truncate text-xs">
                        {r.cancel_reason ?? r.decision_note}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <MovementActions row={r} accounts={accounts} districts={districts} can={can} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {tab === "cashbook" && rows.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t p-3 text-sm">
          <span className="text-success">{t("movement.totalIn", { amount: usd(totalIn) })}</span>
          <span className="text-danger">{t("movement.totalOut", { amount: usd(totalOut) })}</span>
        </div>
      )}
    </div>
  );
}

/** The office's assets: cost, what's been written off, what they're still worth. */
export async function AssetsTab({
  viewer,
  accounts,
  districts,
}: {
  viewer: Viewer;
  accounts: Acct[];
  districts: Dist[];
}) {
  const { t, usd, day, name } = await tools();
  const rows = await listAssets();
  const active = rows.filter((r) => r.status === "active");
  const can = {
    edit: viewer.can("accounting.update"),
    dispose: viewer.can("accounting.approve"),
    delete: viewer.can("accounting.delete"),
  };
  const districtName = (id: string | null) =>
    id ? name(districts.find((d) => d.id === id)) : t("movement.wholeOffice");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label={t("asset.count")}
          value={String(active.length)}
          icon={<Building2 />}
          tone="primary"
        />
        <Tile
          label={t("asset.totalCost")}
          value={usd(active.reduce((s, r) => s + r.cost, 0))}
          icon={<PiggyBank />}
          tone="accent"
        />
        <Tile
          label={t("asset.totalBook")}
          value={usd(active.reduce((s, r) => s + r.book_value, 0))}
          hint={t("asset.totalBookHint", {
            amount: usd(active.reduce((s, r) => s + r.depreciated, 0)),
          })}
          icon={<Scale />}
          tone="warning"
        />
      </div>
      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 text-sm">
          <span className="text-muted-foreground">{t("asset.help")}</span>
          <span className="flex gap-2">
            {viewer.can("accounting.approve") && <DepreciateButton />}
            {viewer.can("accounting.create") && (
              <AssetButton accounts={accounts} districts={districts} />
            )}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">{t("asset.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("asset.name")}</TableHead>
                <TableHead>{t("asset.category")}</TableHead>
                <TableHead>{t("district")}</TableHead>
                <TableHead>{t("asset.acquiredOn")}</TableHead>
                <TableHead className="text-end">{t("asset.cost")}</TableHead>
                <TableHead className="text-end">{t("asset.depreciatedCol")}</TableHead>
                <TableHead className="text-end">{t("asset.bookValue")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className={r.status === "disposed" ? "text-muted-foreground" : ""}
                >
                  <TableCell className="text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      <Mono>{r.number}</Mono>
                      {r.serial_no && ` · ${r.serial_no}`}
                      {r.location && ` · ${r.location}`}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{t(`asset.categories.${r.category}`)}</TableCell>
                  <TableCell className="text-sm">{districtName(r.district_id)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {day(r.acquired_on)}
                    <span className="text-muted-foreground block text-xs">
                      {r.useful_life_months > 0
                        ? t("asset.lifeShort", { months: r.useful_life_months })
                        : t("asset.noDepreciation")}
                    </span>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(r.cost)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">
                    {usd(r.depreciated)}
                  </TableCell>
                  <TableCell className="text-end text-sm font-semibold tabular-nums">
                    {r.status === "active" ? usd(r.book_value) : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[r.status] ?? "draft"}>
                      {t(`asset.status.${r.status}`)}
                    </StatusBadge>
                    {r.status === "disposed" && r.disposed_on && (
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {t("asset.disposedOn", {
                          date: day(r.disposed_on),
                          amount: usd(r.disposal_amount ?? 0),
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <AssetActions row={r} accounts={accounts} districts={districts} can={can} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

const RULE_TONE: Record<string, StatusTone> = {
  draft: "draft",
  approved: "approved",
  retired: "partial",
};
const PAYOUT_TONE: Record<string, StatusTone> = {
  pending: "pending",
  paid: "approved",
  rejected: "rejected",
};

/** Commission and revenue-sharing rules, what each party has earned and is owed, and payouts. */
export async function CommissionsTab({
  from,
  to,
  viewer,
  accounts,
  districts,
}: {
  from: string;
  to: string;
  viewer: Viewer;
  accounts: Acct[];
  districts: Dist[];
}) {
  const { t, usd, name, day } = await tools();
  const supabase = await createClient();
  const [rules, summary, payouts, { data: fees }] = await Promise.all([
    listCommissionRules(),
    commissionSummary(from, to),
    listPayouts(),
    supabase.from("fee_types").select("id, name_so, name_en").eq("active", true).order("name_en"),
  ]);
  const feeTypes = (fees ?? []) as FeeTypeLite[];
  const me = viewer.user.id;
  const can = { edit: viewer.can("accounting.update"), approve: viewer.can("payments.approve") };
  const which = (r: (typeof rules)[number]) =>
    [
      r.method ? t(`rules.methods.${r.method}`) : null,
      r.wallet ? t(`channels.${r.wallet}`) : null,
      r.fee_type_id ? name(feeTypes.find((f) => f.id === r.fee_type_id)) : null,
      r.district_id ? name(districts.find((d) => d.id === r.district_id)) : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("rules.allPayments");
  const rate = (r: (typeof rules)[number]) =>
    [r.pct > 0 ? `${r.pct}%` : null, r.fixed_amount > 0 ? usd(r.fixed_amount) : null]
      .filter(Boolean)
      .join(" + ");

  return (
    <div className="space-y-4">
      <Panel
        title={t("rules.title")}
        action={can.edit ? <RuleButton feeTypes={feeTypes} districts={districts} /> : undefined}
      >
        <p className="text-muted-foreground -mt-2 mb-3 text-sm">{t("rules.help")}</p>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("rules.empty")}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rules.name")}</TableHead>
                  <TableHead>{t("rules.party")}</TableHead>
                  <TableHead>{t("rules.which")}</TableHead>
                  <TableHead className="text-end">{t("rules.rate")}</TableHead>
                  <TableHead>{t("rules.period")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow
                    key={r.id}
                    className={r.status === "retired" ? "text-muted-foreground" : ""}
                  >
                    <TableCell className="text-sm">
                      <span className="font-medium">{r.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        <Mono>{r.code}</Mono> v{r.version} · {t(`rules.kinds.${r.kind}`)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{r.party}</TableCell>
                    <TableCell className="text-sm">{which(r)}</TableCell>
                    <TableCell className="whitespace-nowrap text-end text-sm font-medium tabular-nums">
                      {rate(r)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {day(r.effective_from)} –{" "}
                      {r.effective_to ? day(r.effective_to) : t("rules.open")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={RULE_TONE[r.status] ?? "draft"}>
                        {t(`rules.status.${r.status}`)}
                      </StatusBadge>
                      {r.status === "draft" && r.created_by === me && can.approve && (
                        <span className="text-muted-foreground block text-xs">
                          {t("rules.needsOther")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <RuleActions
                        row={r}
                        me={me}
                        feeTypes={feeTypes}
                        districts={districts}
                        can={can}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title={t("payouts.summaryTitle")}>
        {summary.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("payouts.nothing")}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rules.party")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.payments")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.base")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.accrued")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.reversed")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.paid")}</TableHead>
                  <TableHead className="text-end">{t("payouts.cols.payable")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((s) => (
                  <TableRow key={`${s.party}|${s.payable_account}`}>
                    <TableCell className="text-sm font-medium">
                      {s.party}
                      <span className="text-muted-foreground block text-xs">
                        {t(`rules.kinds.${s.kind}`)}
                      </span>
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{s.payments}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(s.base)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(s.accrued)}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(s.reversed)}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(s.paid)}</TableCell>
                    <TableCell className="text-end text-sm font-semibold tabular-nums">
                      {usd(s.payable)}
                      {s.in_payout > 0 && (
                        <span className="text-muted-foreground block text-xs font-normal">
                          {t("payouts.inPayout", { amount: usd(s.in_payout) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {viewer.can("accounting.create") && s.payable - s.in_payout > 0 && (
                        <PayoutButton
                          party={s.party}
                          payable={s.payable_account}
                          amount={s.payable - s.in_payout}
                          accounts={accounts}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {payouts.length > 0 && (
        <Panel title={t("payouts.title")}>
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("movement.number")}</TableHead>
                  <TableHead>{t("rules.party")}</TableHead>
                  <TableHead>{t("payouts.upto")}</TableHead>
                  <TableHead className="text-end">{t("movement.amount")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      <Mono>{p.number}</Mono>
                      {p.reference && (
                        <span className="text-muted-foreground block text-xs">{p.reference}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{p.party}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{day(p.upto)}</TableCell>
                    <TableCell className="text-end text-sm font-medium tabular-nums">
                      {usd(p.amount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={PAYOUT_TONE[p.status] ?? "draft"}>
                        {t(`payouts.status.${p.status}`)}
                      </StatusBadge>
                      {p.decision_note && (
                        <span className="text-muted-foreground block max-w-48 truncate text-xs">
                          {p.decision_note}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {p.status === "pending" &&
                        viewer.can("payments.approve") &&
                        p.created_by !== me && <PayoutDecide id={p.id} number={p.number} />}
                      {p.status === "pending" && p.created_by === me && (
                        <span className="text-muted-foreground text-xs">
                          {t("payouts.waiting")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/** One account over the period: opening balance, every posting with the balance after it, closing balance. */
export async function LedgerTab({
  account,
  from,
  to,
  districtId,
  accounts,
  districts,
}: {
  account: string;
  from: string;
  to: string;
  districtId: string;
  accounts: Acct[];
  districts: Dist[];
}) {
  const { t, usd, name, day } = await tools();
  const gl = await generalLedger(account, from, to, districtId || null);
  const closing = gl.lines.at(-1)?.balance ?? gl.opening;
  const districtName = (id: string | null) => (id ? name(districts.find((d) => d.id === id)) : "");
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <form className="flex flex-wrap items-end gap-2 border-b p-3 text-sm">
        <input type="hidden" name="tab" value="ledger" />
        <input type="hidden" name="from" value={from} />
        <input type="hidden" name="to" value={to} />
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">{t("account")}</span>
          <select
            name="account"
            defaultValue={account}
            className="bg-background h-9 rounded-md border px-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {name(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">{t("district")}</span>
          <select
            name="district"
            defaultValue={districtId}
            className="bg-background h-9 rounded-md border px-2 text-sm"
          >
            <option value="">{t("ledger.allDistricts")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="hover:bg-muted h-9 rounded-md border px-3 text-sm">
          {t("show")}
        </button>
        <span className="ms-auto flex flex-wrap gap-x-5 text-sm">
          <span>{t("ledger.opening", { amount: usd(gl.opening) })}</span>
          <span>{t("ledger.movement", { debit: usd(gl.debit), credit: usd(gl.credit) })}</span>
          <span className="font-semibold">{t("ledger.closing", { amount: usd(closing) })}</span>
        </span>
      </form>
      {gl.lines.length === 0 ? (
        <p className="text-muted-foreground p-6 text-center text-sm">{t("ledger.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("ledger.entry")}</TableHead>
              <TableHead>{t("memo")}</TableHead>
              <TableHead className="text-end">{t("debit")}</TableHead>
              <TableHead className="text-end">{t("credit")}</TableHead>
              <TableHead className="text-end">{t("balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="text-muted-foreground">
              <TableCell className="text-sm" colSpan={5}>
                {t("ledger.openingRow", { date: day(from) })}
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(gl.opening)}</TableCell>
            </TableRow>
            {gl.lines.map((l, i) => (
              <TableRow key={`${l.entry_id}-${i}`}>
                <TableCell className="whitespace-nowrap text-sm">{day(l.date)}</TableCell>
                <TableCell className="text-sm">
                  <Mono className="text-xs">{l.number}</Mono>
                  <span className="text-muted-foreground block text-xs">
                    {t.has(`sources.${l.source}`) ? t(`sources.${l.source}`) : l.source}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {l.memo}
                  {l.district_id && !districtId && (
                    <span className="text-muted-foreground block text-xs">
                      {districtName(l.district_id)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {l.debit > 0 ? usd(l.debit) : ""}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {l.credit > 0 ? usd(l.credit) : ""}
                </TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">
                  {usd(l.balance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
