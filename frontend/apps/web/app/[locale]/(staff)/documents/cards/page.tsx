import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { IdCard } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CardRowActions } from "@/components/documents/card-row-actions";
import { PrintQueue } from "@/components/documents/document-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { cardPrintPayments, listDocuments } from "@/lib/server/certificates";
import { createClient } from "@/lib/supabase/server";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("idCards");
  return { title: t("title") };
}

const TABS = ["valid", "print", "all"] as const;
type Tab = (typeof TABS)[number];

/** Property ID cards on their own: valid, waiting to be printed, or all (cancelled too), each with its keys. */
export default async function IdCardsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.id_cards");
  const t = await getTranslations("idCards");
  const td = await getTranslations("documents");
  const format = await getFormatter();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "valid";
  const q = (sp.q ?? "").slice(0, 40);
  const supabase = await createClient();
  const count = (unprinted: boolean, valid: boolean) => {
    let r = supabase.from("issued_documents").select("id", { count: "exact", head: true }).eq("type", "id_card");
    if (valid) r = r.eq("status", "valid");
    if (unprinted) r = r.eq("print_count", 0);
    return r;
  };
  const [rows, valid, print, all] = await Promise.all([
    listDocuments({ q, type: "id_card", status: tab === "all" ? "any" : "valid", unprinted: tab === "print" }),
    count(false, true),
    count(true, true),
    count(false, false),
  ]);
  const counts: Record<Tab, number> = { valid: valid.count ?? 0, print: print.count ?? 0, all: all.count ?? 0 };
  // Print payment of the cards not printed yet (shown only while the ID card fee is on).
  const pays = await cardPrintPayments(rows.filter((r) => r.status === "valid" && r.print_count === 0).map((r) => r.id));
  const payNote = Object.fromEntries(
    [...pays].filter(([, p]) => p.feeOn).map(([id, p]) => [id, { text: p.paid ? td("payPaid") : p.invoiceNumber ? td("payOpen", { number: p.invoiceNumber }) : td("payNone"), warn: !p.paid }]),
  );
  const date = (v: string | null) => (v ? format.dateTime(new Date(v), { dateStyle: "medium" }) : "—");

  return (
    <>
      <PageHeader title={t("title")} description={t(`body_${tab}`)}>
        <nav className="flex gap-5 overflow-x-auto text-sm" aria-label={t("title")}>
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/documents/cards?${new URLSearchParams({ tab: k, ...(q ? { q } : {}) })}`}
              aria-current={tab === k ? "page" : undefined}
              className={tabClass(tab === k)}
            >
              {t(`tab_${k}`)}
              <TabCount n={counts[k]} />
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">
        <form className="border-b p-3" role="search">
          <input type="hidden" name="tab" value={tab} />
          <Input name="q" defaultValue={q} placeholder={td("search")} aria-label={td("search")} className="max-w-sm" />
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<IdCard />} title={t("empty")} description={t("emptyBody")} />
        ) : tab === "print" ? (
          <PrintQueue rows={rows} canPrint={viewer.can("certificates.print")} notes={payNote} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{td("serial")}</TableHead>
                <TableHead>{td("holder")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead className="hidden md:table-cell">{td("issuedOn")}</TableHead>
                <TableHead className="hidden md:table-cell">{td("validUntil")}</TableHead>
                <TableHead>{td("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/documents/${d.id}`} className="hover:text-primary">
                      <Mono>{d.serial}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{d.party?.full_name ?? "—"}</TableCell>
                  <TableCell>
                    <Mono>{d.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{date(d.issued_at)}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{date(d.expires_at)}</TableCell>
                  <TableCell className="text-sm">
                    {td(`status.${d.status}`)}
                    {d.status === "valid" && <span className="ms-2 text-xs text-muted-foreground">{d.print_count > 0 ? td("printed") : td("notPrinted")}</span>}
                    {payNote[d.id] && <div className={`text-xs ${payNote[d.id]!.warn ? "text-status-pending" : "text-status-approved"}`}>{payNote[d.id]!.text}</div>}
                  </TableCell>
                  <TableCell>
                    <CardRowActions
                      id={d.id}
                      serial={d.serial}
                      status={d.status}
                      can={{
                        reprint: viewer.can("certificates.reprint"),
                        direct: viewer.isSuperAdmin,
                        cancel: viewer.can("certificates.cancel") && d.issued_by !== viewer.user.id,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
