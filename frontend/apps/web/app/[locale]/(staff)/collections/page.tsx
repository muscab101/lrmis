import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { CopyCheck } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listDuplicates } from "@/lib/server/collections";

export async function generateMetadata() {
  const t = await getTranslations("collections");
  return { title: t("title") };
}

const TABS = ["duplicates"] as const;
type Tab = (typeof TABS)[number];

/** ?from=&to= (ISO dates); by default the last 30 days. */
function range(sp: Record<string, string | undefined>) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const from = iso.test(sp.from ?? "") ? sp.from! : monthAgo;
  const to = iso.test(sp.to ?? "") ? sp.to! : today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export default async function CollectionsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "reconciliation.view");
  const t = await getTranslations("collections");
  const tp = await getTranslations("payments");
  const format = await getFormatter();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : TABS[0];
  const { from, to } = range(sp);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const dt = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const how = (method: string, wallet: string | null) => (wallet && tp.has(`wallets.${wallet}`) ? tp(`wallets.${wallet}`) : tp.has(`methods.${method}`) ? tp(`methods.${method}`) : method);

  const periodForm = (
    <form className="flex flex-wrap items-end gap-3 p-3 text-sm">
      <input type="hidden" name="tab" value={tab} />
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">{t("from")}</span>
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">{t("to")}</span>
        <Input type="date" name="to" defaultValue={to} className="w-40" />
      </label>
      <Button type="submit" size="sm" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );

  let body: React.ReactNode = null;
  if (tab === "duplicates") {
    const rows = await listDuplicates(from, to);
    // Rows come grouped: one group per reference, or per payer + amount + day.
    const groups = [...new Map(rows.map((r) => [`${r.kind}|${r.key}`, rows.filter((x) => x.kind === r.kind && x.key === r.key)])).entries()];
    body = (
      <>
        {periodForm}
        {groups.length === 0 ? (
          <EmptyState icon={<CopyCheck />} title={t("duplicates.none")} description={t("duplicates.noneBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("duplicates.why")}</TableHead>
                <TableHead>{tp("receipt")}</TableHead>
                <TableHead>{tp("received")}</TableHead>
                <TableHead>{tp("method")}</TableHead>
                <TableHead>{tp("reference")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead>{t("cashier")}</TableHead>
                <TableHead className="text-end">{tp("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap(([key, list], gi) =>
                list.map((r, i) => (
                  <TableRow key={`${key}-${r.payment_id}`} className={gi % 2 ? "bg-muted/30" : ""}>
                    <TableCell className="text-sm">{i === 0 ? t(`duplicates.kinds.${r.kind}`) : ""}</TableCell>
                    <TableCell>
                      <Link href={`/payments/${r.payment_id}`} className="text-primary hover:underline">
                        <Mono>{r.receipt_no}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{dt(r.received_at)}</TableCell>
                    <TableCell className="text-sm">{how(r.method, r.wallet)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.reference ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.pun ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.cashier ?? "—"}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(r.amount)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm">
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/collections?tab=${k}`}
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
