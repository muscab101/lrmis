import type { ComboOption } from "@dhulka/ui/combobox";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Calculator } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogEditor } from "@/components/valuation/catalog-editor";
import { OwnerTypesEditor } from "@/components/valuation/owner-types-editor";
import { TransferTypesEditor } from "@/components/valuation/transfer-types-editor";
import { AssessmentRowActions } from "@/components/valuation/row-actions";
import { PriceCheck } from "@/components/valuation/price-check";
import { RatesPanel } from "@/components/valuation/rates-panel";
import { AssessNeighbourhoodButton } from "@/components/valuation/review-queues";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { listAssessments, listFeeTypes, listGrades, listOwnerTypes, listPricedNeighbourhoods, listTransferTypes, neighbourhoodPrices } from "@/lib/server/valuation";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("valuation");
  return { title: t("title") };
}

const TABS = ["price_check", "rates", "grades", "fees", "transfer_types", "owner_types", "assessments"] as const;
/** Exemptions and appeals are no longer used: their old links open the first tab. */
const OLD_TABS: Record<string, Tab> = {};
type Tab = (typeof TABS)[number];

export default async function ValuationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "valuation.view");
  const t = await getTranslations("valuation");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : (OLD_TABS[sp.tab ?? ""] ?? "price_check");
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const badge: Partial<Record<Tab, number>> = {};

  let body: React.ReactNode = null;
  const canReassess = viewer.can("valuation.create");
  const canDeleteAssessment = viewer.can("valuation.approve");
  if (tab === "price_check") {
    const fees = await listFeeTypes();
    const service = fees.find((f) => f.code === "service_charge" && f.active);
    body = <PriceCheck grades={await listGrades()} serviceCharge={Number(service?.amount ?? 0)} />;
  } else if (tab === "assessments") {
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
                {(canReassess || canDeleteAssessment) && <TableHead className="w-20" />}
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
                  {(canReassess || canDeleteAssessment) && (
                    <TableCell className="text-end">
                      <AssessmentRowActions row={a} canReassess={canReassess} canDelete={canDeleteAssessment} />
                    </TableCell>
                  )}
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
    // Keyed by the neighbourhood, so the price boxes start from the chosen one's prices.
    body = (
      <RatesPanel
        key={selected?.value ?? "none"}
        selected={selected}
        grades={await listGrades()}
        prices={selected ? await neighbourhoodPrices(selected.value) : {}}
        priced={selected ? [] : await listPricedNeighbourhoods()}
        canEdit={viewer.can("valuation.update")}
      />
    );
  } else if (tab === "grades") {
    body = <CatalogEditor kind="grades" items={await listGrades()} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "fees") {
    body = <CatalogEditor kind="fees" items={await listFeeTypes()} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "owner_types") {
    body = <OwnerTypesEditor items={await listOwnerTypes()} canEdit={viewer.can("valuation.update")} />;
  } else if (tab === "transfer_types") {
    body = <TransferTypesEditor items={await listTransferTypes()} canEdit={viewer.can("valuation.update")} />;
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-5 overflow-x-auto text-sm" aria-label={t("title")}>
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/valuation?tab=${k}`}
              className={tabClass(tab === k)}
              aria-current={tab === k ? "page" : undefined}
            >
              {t(`tabs.${k}`)}
              {badge[k] !== undefined && <TabCount n={badge[k]} />}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">{body}</Card>
    </>
  );
}
