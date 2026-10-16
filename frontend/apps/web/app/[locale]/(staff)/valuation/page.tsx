import type { ComboOption } from "@dhulka/ui/combobox";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Calculator } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogEditor } from "@/components/valuation/catalog-editor";
import { RatesPanel } from "@/components/valuation/rates-panel";
import { AppealQueue, AssessNeighbourhoodButton, ExemptionQueue } from "@/components/valuation/review-queues";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { listAppeals, listAssessments, listExemptions, listFeeTypes, listGrades, listRates, valuationCounts } from "@/lib/server/valuation";

export async function generateMetadata() {
  const t = await getTranslations("valuation");
  return { title: t("title") };
}

const TABS = ["assessments", "rates", "grades", "fees", "exemptions", "appeals"] as const;
type Tab = (typeof TABS)[number];

export default async function ValuationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "valuation.view");
  const t = await getTranslations("valuation");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "assessments";
  const counts = await valuationCounts();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const badge: Partial<Record<Tab, number>> = { assessments: counts.assessments, exemptions: counts.exemptions_pending, appeals: counts.appeals_open };

  let body: React.ReactNode = null;
  if (tab === "assessments") {
    const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : null;
    const rows = await listAssessments({ year, q: (sp.q ?? "").slice(0, 40), status: sp.all === "1" ? "any" : "issued" });
    body = (
      <>
        <form className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
          <input type="hidden" name="tab" value="assessments" />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("searchAssessments")} aria-label={t("searchAssessments")} className="max-w-xs" />
          <Input name="year" defaultValue={sp.year ?? ""} placeholder={t("year")} aria-label={t("year")} inputMode="numeric" className="w-28" />
          {viewer.can("valuation.create") && (
            <span className="ms-auto">
              <AssessNeighbourhoodButton />
            </span>
          )}
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<Calculator />} title={t("noAssessments")} description={t("noAssessmentsBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("assessment")}</TableHead>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead>{t("year")}</TableHead>
                <TableHead className="text-end">{t("annualTax")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("issued")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Mono>{a.number}</Mono>
                  </TableCell>
                  <TableCell>
                    <Link href={`/parcels/${a.parcel?.id}`} className="hover:text-primary">
                      <Mono>{a.parcel?.pun ?? "—"}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{a.year}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(a.total)}</TableCell>
                  <TableCell className="text-sm">
                    {t(`assessmentStatus.${a.status}`)}
                    {a.override_note && <span className="block text-xs text-muted-foreground">{a.override_note}</span>}
                  </TableCell>
                  <TableCell className="text-end text-xs text-muted-foreground">{format.relativeTime(new Date(a.created_at))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </>
    );
  } else if (tab === "rates") {
    const nId = sp.n && /^[0-9a-f-]{36}$/i.test(sp.n) ? sp.n : null;
    let selected: ComboOption | null = null;
    if (nId) {
      const supabase = await createClient();
      const { data } = await supabase.from("neighbourhoods").select("id, code, name_so, name_en, district:districts(code)").eq("id", nId).maybeSingle();
      const n = data as { id: string; code: string; name_so: string; name_en: string; district: { code: string } | null } | null;
      if (n) selected = { value: n.id, label: lang === "so" ? n.name_so : n.name_en, hint: `${n.district?.code ?? ""}-${n.code}` };
    }
    body = <RatesPanel rates={await listRates(nId)} selected={selected} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "grades") {
    body = <CatalogEditor kind="grades" items={await listGrades()} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "fees") {
    body = <CatalogEditor kind="fees" items={await listFeeTypes()} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "exemptions") {
    body = <ExemptionQueue rows={await listExemptions(sp.all === "1" ? "any" : "pending")} me={viewer.user.id} canDecide={viewer.can("valuation.approve")} />;
  } else {
    body = <AppealQueue rows={await listAppeals(sp.all === "1" ? "any" : "open")} me={viewer.user.id} canDecide={viewer.can("valuation.approve")} />;
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm" aria-label={t("title")}>
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/valuation?tab=${k}`}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 whitespace-nowrap ${tab === k ? "border-flag font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              aria-current={tab === k ? "page" : undefined}
            >
              {t(`tabs.${k}`)}
              {badge[k] !== undefined && <span className="rounded-sm bg-muted px-1.5 font-mono text-[11px]">{badge[k]}</span>}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
      {(tab === "exemptions" || tab === "appeals") && (
        <p className="mt-3 text-sm">
          <Link href={`/valuation?tab=${tab}${sp.all === "1" ? "" : "&all=1"}`} className="text-primary hover:underline">
            {sp.all === "1" ? t("showPendingOnly") : t("showAll")}
          </Link>
        </p>
      )}
    </>
  );
}
