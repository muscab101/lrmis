import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Landmark } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("accountsSettings");
  return { title: t("title") };
}

const TABS = ["pos", "cashiers", "groups", "banks", "currencies"] as const;
type Tab = (typeof TABS)[number];
const CASH_ACCOUNTS = /^11/;

/** Accounts Settings (old menu): points of sale, cashiers, GL account groups, bank accounts, currencies. */
export default async function AccountsSettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "accounting.view");
  const t = await getTranslations("accountsSettings");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "pos";
  const supabase = await createClient();
  const name = (r: { name_so: string; name_en: string }) => (lang === "so" ? r.name_so : r.name_en);
  const date = (d: string) => format.dateTime(new Date(d), { dateStyle: "medium" });

  let body: React.ReactNode;
  if (tab === "pos") {
    const { data } = await supabase.from("points_of_sale").select("id, code, name, kind, receipt_prefix, active, district:districts(name_so, name_en)").order("code");
    const rows = (data ?? []) as unknown as { id: string; code: string; name: string; kind: string; receipt_prefix: string; active: boolean; district: { name_so: string; name_en: string } | null }[];
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("code")}</TableHead>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("kind")}</TableHead>
            <TableHead>{t("district")}</TableHead>
            <TableHead>{t("receiptPrefix")}</TableHead>
            <TableHead>{t("state")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Mono>{r.code}</Mono>
              </TableCell>
              <TableCell className="text-sm">{r.name}</TableCell>
              <TableCell className="text-sm">{t(`kinds.${r.kind}`)}</TableCell>
              <TableCell className="text-sm">{r.district ? name(r.district) : t("allDistricts")}</TableCell>
              <TableCell>
                <Mono className="text-xs">{r.receipt_prefix}-YYYY-NNNNNN</Mono>
              </TableCell>
              <TableCell className="text-sm">{r.active ? t("active") : t("inactive")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (tab === "cashiers") {
    const { data } = await supabase
      .from("cashier_shifts")
      .select("id, number, status, opened_at, closed_at, opening_float, difference, cashier_id, pos:points_of_sale(code, name)")
      .order("opened_at", { ascending: false })
      .limit(200);
    const shifts = (data ?? []) as unknown as { id: string; number: string; status: string; opened_at: string; closed_at: string | null; opening_float: number; difference: number | null; cashier_id: string; pos: { code: string; name: string } | null }[];
    const ids = [...new Set(shifts.map((s) => s.cashier_id))];
    const { data: names } = ids.length ? await supabase.rpc("staff_display_names", { p_user_ids: ids }) : { data: [] };
    const nameOf = new Map(((names ?? []) as { user_id: string; full_name: string }[]).map((n) => [n.user_id, n.full_name]));
    // One row per cashier: their latest shift.
    const latest = [...new Map(shifts.map((s) => [s.cashier_id, s])).values()];
    const byCashier = new Map<string, number>();
    for (const s of shifts) byCashier.set(s.cashier_id, (byCashier.get(s.cashier_id) ?? 0) + 1);
    body =
      latest.length === 0 ? (
        <EmptyState icon={<Landmark />} title={t("noCashiers")} description={t("noCashiersBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cashier")}</TableHead>
              <TableHead>{t("pointOfSale")}</TableHead>
              <TableHead>{t("lastShift")}</TableHead>
              <TableHead className="text-end">{t("shifts")}</TableHead>
              <TableHead>{t("state")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {latest.map((s) => (
              <TableRow key={s.cashier_id}>
                <TableCell className="text-sm">{nameOf.get(s.cashier_id) || "—"}</TableCell>
                <TableCell className="text-sm">
                  <Mono className="text-xs">{s.pos?.code}</Mono> {s.pos?.name}
                </TableCell>
                <TableCell className="text-sm">
                  <Mono className="text-xs">{s.number}</Mono> · {date(s.opened_at)}
                </TableCell>
                <TableCell className="text-end text-sm tabular-nums">{byCashier.get(s.cashier_id)}</TableCell>
                <TableCell className="text-sm">{s.status === "open" ? t("onShift") : t("offShift")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
  } else if (tab === "groups" || tab === "banks") {
    const { data } = await supabase.from("gl_accounts").select("code, name_so, name_en, type, active").order("code");
    const accounts = (data ?? []) as { code: string; name_so: string; name_en: string; type: string; active: boolean }[];
    if (tab === "groups") {
      const groups = ["asset", "liability", "equity", "income", "expense"].map((g) => ({ g, items: accounts.filter((a) => a.type === g) }));
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("group")}</TableHead>
              <TableHead>{t("accounts")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(({ g, items }) => (
              <TableRow key={g}>
                <TableCell className="align-top text-sm font-medium">{t(`groups.${g}`)}</TableCell>
                <TableCell className="text-sm">
                  {items.map((a) => (
                    <span key={a.code} className="me-4 inline-block">
                      <Mono className="text-xs">{a.code}</Mono> {name(a)}
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    } else {
      body = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("glCode")}</TableHead>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("state")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts
              .filter((a) => CASH_ACCOUNTS.test(a.code))
              .map((a) => (
                <TableRow key={a.code}>
                  <TableCell>
                    <Mono>{a.code}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{name(a)}</TableCell>
                  <TableCell className="text-sm">{a.active ? t("active") : t("inactive")}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      );
    }
  } else {
    const [{ data: cur }, { data: rates }] = await Promise.all([
      supabase.from("currencies").select("code, name_so, name_en, decimals, active").order("code"),
      supabase.from("fx_rates").select("currency, rate_date, rate").order("rate_date", { ascending: false }).limit(500),
    ]);
    const last = new Map<string, { rate: number; rate_date: string }>();
    for (const r of (rates ?? []) as { currency: string; rate_date: string; rate: number }[]) if (!last.has(r.currency)) last.set(r.currency, r);
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("code")}</TableHead>
            <TableHead>{t("name")}</TableHead>
            <TableHead className="text-end">{t("latestRate")}</TableHead>
            <TableHead>{t("state")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {((cur ?? []) as { code: string; name_so: string; name_en: string; active: boolean }[]).map((c) => {
            const r = last.get(c.code);
            return (
              <TableRow key={c.code}>
                <TableCell>
                  <Mono>{c.code}</Mono>
                </TableCell>
                <TableCell className="text-sm">{name(c)}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {c.code === "USD" ? t("base") : r ? `${format.number(Number(r.rate))} · ${date(r.rate_date)}` : "—"}
                </TableCell>
                <TableCell className="text-sm">{c.active ? t("active") : t("inactive")}</TableCell>
              </TableRow>
            );
          })}
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
              href={`/settings/accounts?tab=${k}`}
              className={`-mb-px border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${k}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("hint")}{" "}
        <Link href="/accounting?tab=accounts" className="text-primary hover:underline">
          {t("toAccounting")}
        </Link>
      </p>
    </>
  );
}
