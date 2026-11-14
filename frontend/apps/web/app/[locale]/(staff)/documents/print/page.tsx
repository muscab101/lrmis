import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BadgeCheck } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CardRowActions } from "@/components/documents/card-row-actions";
import { GoApprove } from "@/components/approvals/go-approve";
import { IssueQueue, PrintQueue, ReprintQueue } from "@/components/documents/document-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { certificatesCounts, listDocuments, listReprints, parcelsToCertify } from "@/lib/server/certificates";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("documents");
  return { title: t("title") };
}

/** Title certificates only; property ID cards have their own page (/documents/cards). */
const TABS = ["documents", "print", "issue", "reprints"] as const;
type Tab = (typeof TABS)[number];

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.view");
  const t = await getTranslations("documents");
  const format = await getFormatter();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "documents";
  const counts = await certificatesCounts();
  const badge: Record<Tab, number> = { issue: counts.registered_without, print: counts.unprinted, documents: counts.valid_certificates, reprints: counts.reprints_pending };

  let body: React.ReactNode;
  if (tab === "issue") {
    const rows = await parcelsToCertify();
    body =
      rows.length === 0 ? (
        <EmptyState icon={<BadgeCheck />} title={t("nothingToIssue")} description={t("nothingToIssueBody")} />
      ) : (
        <>
          {viewer.can("certificates.approve") && (
            <div className="flex justify-end border-b px-4 py-2.5">
              <GoApprove tab="certificates" />
            </div>
          )}
          {/* Issuing is approved on Applications: here the list only shows what is ready and what is missing. */}
          <IssueQueue rows={rows} />
        </>
      );
  } else if (tab === "reprints") {
    body = (
      <>
      {viewer.can("certificates.approve") && (
        <div className="flex justify-end border-b px-4 py-2.5">
          <GoApprove tab="certificates" />
        </div>
      )}
      <ReprintQueue
        rows={await listReprints(sp.all === "1" ? "any" : "pending")}
        me={viewer.user.id}
        canCashier={viewer.can("cashier.view")}
      />
      </>
    );
  } else {
    const rows = await listDocuments({
      q: (sp.q ?? "").slice(0, 40),
      status: tab === "print" ? "valid" : sp.all === "1" ? "any" : "valid",
      unprinted: tab === "print",
      type: "certificate",
    });
    body = (
      <>
        {tab === "documents" && (
          <form className="border-b p-3" role="search">
            <input type="hidden" name="tab" value={tab} />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} aria-label={t("search")} className="max-w-sm" />
          </form>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={<BadgeCheck />} title={tab === "print" ? t("nothingToPrint") : t("noDocuments")} description={tab === "print" ? t("nothingToPrintBody") : t("noDocumentsBody")} />
        ) : tab === "print" ? (
          <PrintQueue rows={rows} canPrint={viewer.can("certificates.print")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("serial")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("issuedOn")}</TableHead>
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
                  <TableCell>
                    <Mono>{d.parcel?.pun}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">
                    {t(`status.${d.status}`)}
                    {d.status === "valid" && <span className="ms-2 text-xs text-muted-foreground">{d.print_count > 0 ? t("printed") : t("notPrinted")}</span>}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{format.dateTime(new Date(d.issued_at), { dateStyle: "medium" })}</TableCell>
                  <TableCell>
                    <CardRowActions
                      kind="certificate"
                      id={d.id}
                      serial={d.serial}
                      status={d.status}
                      can={{
                        reprint: viewer.can("certificates.reprint"),
                        direct: viewer.isSuperAdmin,
                        cancel: viewer.can("certificates.cancel") && d.issued_by !== viewer.user.id,
                        print: viewer.can("certificates.print") && d.print_count === 0,
                        view: viewer.can("certificates.design"),
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
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
              href={`/documents/print?tab=${k}`}
              className={tabClass(tab === k)}
            >
              {t(`tabs.${k}`)}
              <TabCount n={badge[k]} />
            </Link>
          ))}
        </nav>
      </PageHeader>
      {tab === "issue" && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <KpiChip label={t("kpiValid")} value={format.number(counts.valid_certificates)} />
          <KpiChip label={t("kpiWithout")} value={format.number(counts.registered_without)} />
          <KpiChip label={t("kpiUnprinted")} value={format.number(counts.unprinted)} />
        </div>
      )}
      <Card className="overflow-hidden">{body}</Card>
    </>
  );
}
