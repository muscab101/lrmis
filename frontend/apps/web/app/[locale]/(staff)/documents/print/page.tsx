import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BadgeCheck } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { IssueCertificateButton, ReprintQueue } from "@/components/documents/document-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { certificatesCounts, listDocuments, listReprints, parcelsToCertify } from "@/lib/server/certificates";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("documents");
  return { title: t("title") };
}

const TABS = ["issue", "print", "documents", "reprints", "report"] as const;
type Tab = (typeof TABS)[number];

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.view");
  const t = await getTranslations("documents");
  const format = await getFormatter();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : viewer.can("certificates.approve") ? "issue" : "print";
  const counts = await certificatesCounts();
  const badge: Record<Tab, number | null> = { issue: counts.registered_without, print: counts.unprinted, documents: counts.valid_certificates, reprints: counts.reprints_pending, report: null };

  let body: React.ReactNode;
  if (tab === "issue") {
    const rows = await parcelsToCertify();
    body =
      rows.length === 0 ? (
        <EmptyState icon={<BadgeCheck />} title={t("nothingToIssue")} description={t("nothingToIssueBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PUN</TableHead>
              <TableHead>{t("registered")}</TableHead>
              <TableHead>{t("eligibility")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                    <Mono>{p.pun}</Mono>
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{p.registered_at ? format.dateTime(new Date(p.registered_at), { dateStyle: "medium" }) : "—"}</TableCell>
                <TableCell className="text-sm">
                  {p.blockers.length === 0 ? <span className="text-status-approved">{t("eligible")}</span> : p.blockers.map((b) => t(`blockers.${b}`)).join(" · ")}
                </TableCell>
                <TableCell className="text-end">{p.blockers.length === 0 && viewer.can("certificates.approve") && <IssueCertificateButton parcelId={p.id} pun={p.pun} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
  } else if (tab === "report") {
    // Printing report: every print logged, with who printed what and when.
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const to = iso.test(sp.to ?? "") ? sp.to! : new Date().toISOString().slice(0, 10);
    const from = iso.test(sp.from ?? "") ? sp.from! : `${to.slice(0, 7)}-01`;
    const supabase = await createClient();
    const { data } = await supabase
      .from("print_jobs")
      .select("id, kind, printed_at, printed_by, document:issued_documents(id, serial, type, parcel:parcels(pun))")
      .gte("printed_at", from)
      .lt("printed_at", new Date(Date.parse(to) + 864e5).toISOString())
      .order("printed_at", { ascending: false })
      .limit(1000);
    const jobs = (data ?? []) as unknown as { id: number; kind: "original" | "reprint"; printed_at: string; printed_by: string | null; document: { id: string; serial: string; type: string; parcel: { pun: string | null } | null } | null }[];
    const ids = [...new Set(jobs.map((j) => j.printed_by).filter(Boolean))] as string[];
    const { data: names } = ids.length ? await supabase.rpc("staff_display_names", { p_user_ids: ids }) : { data: [] };
    const nameOf = new Map(((names ?? []) as { user_id: string; full_name: string }[]).map((n) => [n.user_id, n.full_name]));
    const count = (k: string, type?: string) => jobs.filter((j) => j.kind === k && (!type || j.document?.type === type)).length;
    body = (
      <>
        <form className="flex flex-wrap items-end gap-3 border-b p-3 text-sm">
          <input type="hidden" name="tab" value="report" />
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("from")}</span>
            <Input type="date" name="from" defaultValue={from} className="w-40" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("to")}</span>
            <Input type="date" name="to" defaultValue={to} className="w-40" />
          </label>
          <button type="submit" className="h-9 rounded-md border px-3 hover:bg-muted">
            {t("apply")}
          </button>
          <span className="ms-auto text-muted-foreground">
            {t("reportSummary", { certs: count("original", "certificate"), cards: count("original", "id_card"), reprints: count("reprint") })}
          </span>
        </form>
        {jobs.length === 0 ? (
          <EmptyState icon={<BadgeCheck />} title={t("noPrints")} description={t("noPrintsBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("printedAt")}</TableHead>
                <TableHead>{t("serial")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead>{t("printKindLabel")}</TableHead>
                <TableHead>{t("printedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="text-sm whitespace-nowrap">{format.dateTime(new Date(j.printed_at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                  <TableCell>
                    {j.document ? (
                      <Link href={`/documents/${j.document.id}`} className="hover:text-primary">
                        <Mono>{j.document.serial}</Mono>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Mono className="text-xs">{j.document?.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{t(`printKinds.${j.kind}`)}</TableCell>
                  <TableCell className="text-sm">{(j.printed_by && nameOf.get(j.printed_by)) || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </>
    );
  } else if (tab === "reprints") {
    body = <ReprintQueue rows={await listReprints(sp.all === "1" ? "any" : "pending")} me={viewer.user.id} canDecide={viewer.can("certificates.approve")} />;
  } else {
    const rows = await listDocuments({ q: (sp.q ?? "").slice(0, 40), status: tab === "print" ? "valid" : sp.all === "1" ? "any" : "valid", unprinted: tab === "print" });
    body = (
      <>
        {tab === "documents" && (
          <form className="border-b p-3" role="search">
            <input type="hidden" name="tab" value="documents" />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} aria-label={t("search")} className="max-w-sm" />
          </form>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={<BadgeCheck />} title={tab === "print" ? t("nothingToPrint") : t("noDocuments")} description={tab === "print" ? t("nothingToPrintBody") : t("noDocumentsBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("serial")}</TableHead>
                <TableHead>{t("type")}</TableHead>
                <TableHead>PUN</TableHead>
                <TableHead>{t("holder")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("issuedOn")}</TableHead>
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
                  <TableCell className="text-sm">{t(`types.${d.type}`)}</TableCell>
                  <TableCell>
                    <Mono>{d.parcel?.pun}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{d.party?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {t(`status.${d.status}`)}
                    {d.status === "valid" && <span className="ms-2 text-xs text-muted-foreground">{d.print_count > 0 ? t("printed") : t("notPrinted")}</span>}
                  </TableCell>
                  <TableCell className="text-end text-xs text-muted-foreground">{format.dateTime(new Date(d.issued_at), { dateStyle: "medium" })}</TableCell>
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
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t(`tabs.${k}`)}
              {badge[k] !== null && <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{badge[k]}</span>}
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
