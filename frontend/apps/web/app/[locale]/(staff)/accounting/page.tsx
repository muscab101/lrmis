import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import {
  AccountButton,
  AccountDelete,
  JournalReverseButton,
} from "@/components/accounting/account-forms";
import {
  AssetsTab,
  CommissionsTab,
  DistrictsTab,
  LedgerTab,
  MovementsTab,
  OverviewTab,
} from "@/components/accounting/tabs";
import {
  FxRateButton,
  ManualJournalButton,
  PeriodButton,
} from "@/components/payments/accounting-forms";
import { Link } from "@/i18n/navigation";
import type { MovementStatus } from "@/lib/server/accounting";
import { requirePermission } from "@/lib/server/auth";
import {
  listAccounts,
  listFxRates,
  listJournal,
  listPeriods,
  trialBalance,
} from "@/lib/server/payments";
import { myDistricts } from "@/lib/server/scope";

export async function generateMetadata() {
  const t = await getTranslations("accounting");
  return { title: t("title") };
}

const TABS = [
  "overview",
  "districts",
  "deposits",
  "cashbook",
  "assets",
  "commissions",
  "trial",
  "journal",
  "ledger",
  "accounts",
  "rates",
  "periods",
] as const;
type Tab = (typeof TABS)[number];
const DATED: Tab[] = ["overview", "districts", "commissions", "trial", "ledger"];
const STATUSES: MovementStatus[] = ["pending", "confirmed", "rejected", "cancelled"];
// Accounts the system posts to by itself (kept in step with private.system_account).
const SYSTEM = [
  "1100",
  "1110",
  "1120",
  "1130",
  "1200",
  "1500",
  "1590",
  "2100",
  "3100",
  "4100",
  "4110",
  "4200",
  "4300",
  "4400",
  "5100",
  "5300",
];
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function AccountingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "accounting.view");
  const t = await getTranslations("accounting");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "overview";
  const now = new Date();
  const from = isDate(sp.from) ? sp.from! : `${now.getFullYear()}-01-01`;
  const to = isDate(sp.to) ? sp.to! : iso(now);
  const status = (STATUSES as string[]).includes(sp.status ?? "")
    ? (sp.status as MovementStatus)
    : null;
  const money = (n: number) =>
    format.number(Number(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [accounts, districts] = await Promise.all([listAccounts(), myDistricts()]);
  const aname = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? (lang === "so" ? a.name_so : a.name_en) : code;
  };
  const quick = [
    { key: "last30", from: iso(new Date(now.getTime() - 29 * 86400000)) },
    { key: "thisMonth", from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) },
    { key: "thisYear", from: `${now.getFullYear()}-01-01` },
  ];

  const periodFilter = (
    <form className="flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="tab" value={tab} />
      {tab === "ledger" && sp.account && <input type="hidden" name="account" value={sp.account} />}
      {tab === "ledger" && sp.district && (
        <input type="hidden" name="district" value={sp.district} />
      )}
      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">{t("from")}</span>
        <Input type="date" name="from" defaultValue={from} />
      </label>
      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">{t("to")}</span>
        <Input type="date" name="to" defaultValue={to} />
      </label>
      <button type="submit" className="hover:bg-muted h-9 rounded-md border px-3 text-sm">
        {t("show")}
      </button>
      <span className="flex flex-wrap gap-1">
        {quick.map((q) => (
          <Link
            key={q.key}
            href={`/accounting?tab=${tab}&from=${q.from}&to=${iso(now)}${tab === "ledger" && sp.account ? `&account=${sp.account}` : ""}`}
            className={`rounded-full border px-3 py-1 text-xs ${from === q.from && to === iso(now) ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted"}`}
          >
            {t(`quick.${q.key}`)}
          </Link>
        ))}
      </span>
    </form>
  );

  let body: React.ReactNode;
  if (tab === "overview") {
    body = <OverviewTab from={from} to={to} />;
  } else if (tab === "districts") {
    body = (
      <DistrictsTab from={from} to={to} viewer={viewer} accounts={accounts} districts={districts} />
    );
  } else if (tab === "deposits" || tab === "cashbook") {
    body = (
      <MovementsTab
        tab={tab}
        status={status}
        viewer={viewer}
        accounts={accounts}
        districts={districts}
      />
    );
  } else if (tab === "assets") {
    body = <AssetsTab viewer={viewer} accounts={accounts} districts={districts} />;
  } else if (tab === "commissions") {
    body = (
      <CommissionsTab
        from={from}
        to={to}
        viewer={viewer}
        accounts={accounts}
        districts={districts}
      />
    );
  } else if (tab === "ledger") {
    const account = accounts.some((a) => a.code === sp.account) ? sp.account! : "1130";
    const districtId = districts.some((d) => d.id === sp.district) ? sp.district! : "";
    body = (
      <LedgerTab
        account={account}
        from={from}
        to={to}
        districtId={districtId}
        accounts={accounts}
        districts={districts}
      />
    );
  } else if (tab === "trial") {
    const rows = await trialBalance(from, to);
    const dr = rows.reduce((s, r) => s + Number(r.debit), 0);
    const cr = rows.reduce((s, r) => s + Number(r.credit), 0);
    body = (
      <Card className="overflow-hidden">
        {viewer.can("accounting.create") && (
          <div className="flex justify-end border-b p-3">
            <ManualJournalButton accounts={accounts.filter((a) => a.active)} />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("account")}</TableHead>
              <TableHead className="text-end">{t("debit")}</TableHead>
              <TableHead className="text-end">{t("credit")}</TableHead>
              <TableHead className="text-end">{t("balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.account}
                className={Number(r.debit) + Number(r.credit) === 0 ? "text-muted-foreground" : ""}
              >
                <TableCell className="text-sm">
                  <Mono>{r.account}</Mono> {lang === "so" ? r.name_so : r.name_en}
                  <span className="text-muted-foreground ms-2 text-xs">{t(`types.${r.type}`)}</span>
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.debit)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.credit)}</TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">
                  {money(r.balance)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">{t("totals2")}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums">{money(dr)}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums">{money(cr)}</TableCell>
              <TableCell
                className={`text-end text-sm ${Math.abs(dr - cr) < 0.005 ? "text-status-approved" : "text-status-rejected"}`}
              >
                {Math.abs(dr - cr) < 0.005 ? t("balanced") : t("unbalanced")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    );
  } else if (tab === "journal") {
    const entries = await listJournal(80);
    const canReverse = viewer.can("accounting.cancel");
    body = (
      <Card className="overflow-hidden">
        {viewer.can("accounting.create") && (
          <div className="flex justify-end border-b p-3">
            <ManualJournalButton accounts={accounts.filter((a) => a.active)} />
          </div>
        )}
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <Mono>{e.number}</Mono> · {e.entry_date} · {e.memo}
                </span>
                <span className="text-muted-foreground flex items-center gap-2 text-xs">
                  {e.reversed_by ? t("reversedTag") : e.reverses ? t("reversalTag") : null}
                  {t.has(`sources.${e.source}`) ? t(`sources.${e.source}`) : e.source}
                  {canReverse && e.source === "manual" && !e.reversed_by && !e.reverses && (
                    <JournalReverseButton id={e.id} number={e.number} />
                  )}
                </span>
              </div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {e.journal_lines.map((l) => (
                    <tr key={l.id}>
                      <td className={`py-0.5 ${Number(l.credit) > 0 ? "ps-6" : ""}`}>
                        <Mono>{l.account}</Mono> {aname(l.account)}
                      </td>
                      <td className="w-28 text-end tabular-nums">
                        {Number(l.debit) > 0 ? money(l.debit) : ""}
                      </td>
                      <td className="w-28 text-end tabular-nums">
                        {Number(l.credit) > 0 ? money(l.credit) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      </Card>
    );
  } else if (tab === "accounts") {
    const canEdit = viewer.can("accounting.update");
    const canDelete = viewer.can("accounting.delete");
    body = (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3 text-sm">
          <span className="text-muted-foreground">{t("accountForm.help")}</span>
          {canEdit && <AccountButton />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("code")}</TableHead>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("statusLabel")}</TableHead>
              {(canEdit || canDelete) && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const system = SYSTEM.includes(a.code);
              return (
                <TableRow key={a.code} className={a.active ? "" : "text-muted-foreground"}>
                  <TableCell>
                    <Mono>{a.code}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">
                    {lang === "so" ? a.name_so : a.name_en}
                    {a.is_bank && <span className="text-primary ms-2 text-xs">{t("bank")}</span>}
                    {system && (
                      <span className="text-muted-foreground ms-2 text-xs">
                        {t("accountForm.system")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{t(`types.${a.type}`)}</TableCell>
                  <TableCell className="text-sm">
                    {a.active ? t("accountForm.on") : t("accountForm.off")}
                  </TableCell>
                  {(canEdit || canDelete) && (
                    <TableCell className="text-end">
                      <span className="inline-flex gap-0.5">
                        {canEdit && <AccountButton row={a} system={system} />}
                        {canDelete && !system && a.active && <AccountDelete row={a} />}
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    );
  } else if (tab === "rates") {
    const rates = await listFxRates();
    body = (
      <Card className="overflow-hidden">
        <div className="text-muted-foreground flex items-center justify-between border-b p-3 text-sm">
          {t("ratesHelp")}
          {viewer.can("accounting.update") && <FxRateButton />}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("currency")}</TableHead>
              <TableHead className="text-end">{t("perUsd")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">{r.rate_date}</TableCell>
                <TableCell className="text-sm">{r.currency}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {format.number(Number(r.rate))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  } else {
    const periods = await listPeriods();
    const months: { year: number; month: number; status: "open" | "locked" }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const p = periods.find((x) => x.year === d.getFullYear() && x.month === d.getMonth() + 1);
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1, status: p?.status ?? "open" });
    }
    body = (
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("period")}</TableHead>
              <TableHead>{t("statusLabel")}</TableHead>
              {viewer.can("accounting.approve") && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={`${m.year}-${m.month}`}>
                <TableCell className="text-sm">
                  {format.dateTime(new Date(m.year, m.month - 1, 1), {
                    year: "numeric",
                    month: "long",
                  })}
                </TableCell>
                <TableCell className="text-sm">{t(`periodStatus.${m.status}`)}</TableCell>
                {viewer.can("accounting.approve") && (
                  <TableCell className="text-end">
                    <PeriodButton year={m.year} month={m.month} locked={m.status === "locked"} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/accounting?tab=${k}`}
              className={`-mb-px whitespace-nowrap border-b-2 pb-2 ${tab === k ? "border-flag text-foreground font-medium" : "text-muted-foreground hover:text-foreground border-transparent"}`}
            >
              {t(`tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <div className="space-y-4">
        {DATED.includes(tab) && periodFilter}
        {body}
      </div>
    </>
  );
}
