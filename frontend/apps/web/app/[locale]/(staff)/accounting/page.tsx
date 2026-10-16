import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { FxRateButton, ManualJournalButton, PeriodButton } from "@/components/payments/accounting-forms";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listAccounts, listFxRates, listJournal, listPeriods, trialBalance } from "@/lib/server/payments";

export async function generateMetadata() {
  const t = await getTranslations("accounting");
  return { title: t("title") };
}

const TABS = ["trial", "journal", "accounts", "rates", "periods"] as const;
type Tab = (typeof TABS)[number];
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function AccountingPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "accounting.view");
  const t = await getTranslations("accounting");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "trial";
  const now = new Date();
  const from = isDate(sp.from) ? sp.from! : `${now.getFullYear()}-01-01`;
  const to = isDate(sp.to) ? sp.to! : now.toISOString().slice(0, 10);
  const money = (n: number) => format.number(Number(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const accounts = await listAccounts();
  const aname = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? (lang === "so" ? a.name_so : a.name_en) : code;
  };

  let body: React.ReactNode;
  if (tab === "trial") {
    const rows = await trialBalance(from, to);
    const dr = rows.reduce((s, r) => s + Number(r.debit), 0);
    const cr = rows.reduce((s, r) => s + Number(r.credit), 0);
    body = (
      <>
        <form className="flex flex-wrap items-end gap-2 border-b p-3 text-sm">
          <input type="hidden" name="tab" value="trial" />
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">{t("from")}</span>
            <Input type="date" name="from" defaultValue={from} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">{t("to")}</span>
            <Input type="date" name="to" defaultValue={to} />
          </label>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
            {t("show")}
          </button>
          {viewer.can("accounting.create") && (
            <span className="ms-auto">
              <ManualJournalButton accounts={accounts.filter((a) => a.active)} />
            </span>
          )}
        </form>
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
              <TableRow key={r.account} className={Number(r.debit) + Number(r.credit) === 0 ? "text-muted-foreground" : ""}>
                <TableCell className="text-sm">
                  <Mono>{r.account}</Mono> {lang === "so" ? r.name_so : r.name_en}
                  <span className="ms-2 text-xs text-muted-foreground">{t(`types.${r.type}`)}</span>
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.debit)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">{money(r.credit)}</TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">{money(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">{t("totals2")}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums">{money(dr)}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums">{money(cr)}</TableCell>
              <TableCell className={`text-end text-sm ${Math.abs(dr - cr) < 0.005 ? "text-status-approved" : "text-status-rejected"}`}>
                {Math.abs(dr - cr) < 0.005 ? t("balanced") : t("unbalanced")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>
    );
  } else if (tab === "journal") {
    const entries = await listJournal(60);
    body = (
      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <Mono>{e.number}</Mono> · {e.entry_date} · {e.memo}
              </span>
              <span className="text-xs text-muted-foreground">{t(`sources.${e.source}`)}</span>
            </div>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {e.journal_lines.map((l) => (
                  <tr key={l.id}>
                    <td className={`py-0.5 ${Number(l.credit) > 0 ? "ps-6" : ""}`}>
                      <Mono>{l.account}</Mono> {aname(l.account)}
                    </td>
                    <td className="w-28 text-end tabular-nums">{Number(l.debit) > 0 ? money(l.debit) : ""}</td>
                    <td className="w-28 text-end tabular-nums">{Number(l.credit) > 0 ? money(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        ))}
      </ul>
    );
  } else if (tab === "accounts") {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("code")}</TableHead>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("type")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.code}>
              <TableCell>
                <Mono>{a.code}</Mono>
              </TableCell>
              <TableCell className="text-sm">{lang === "so" ? a.name_so : a.name_en}</TableCell>
              <TableCell className="text-sm">{t(`types.${a.type}`)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (tab === "rates") {
    const rates = await listFxRates();
    body = (
      <>
        <div className="flex items-center justify-between border-b p-3 text-sm text-muted-foreground">
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
                <TableCell className="text-end text-sm tabular-nums">{format.number(Number(r.rate))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
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
              <TableCell className="text-sm">{format.dateTime(new Date(m.year, m.month - 1, 1), { year: "numeric", month: "long" })}</TableCell>
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
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
    </>
  );
}
