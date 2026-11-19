import type { ComboOption } from "@dhulka/ui/combobox";
import { Card } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { CatalogEditor } from "@/components/valuation/catalog-editor";
import { OwnerTypesEditor } from "@/components/valuation/owner-types-editor";
import { TransferTypesEditor } from "@/components/valuation/transfer-types-editor";
import { PriceCheck } from "@/components/valuation/price-check";
import { RatesPanel } from "@/components/valuation/rates-panel";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { listFeeTypes, listGrades, listOwnerTypes, listPricedNeighbourhoods, listTransferTypes, neighbourhoodPrices } from "@/lib/server/valuation";
import { TabCount, tabClass } from "@/components/shell/tabs";

export async function generateMetadata() {
  const t = await getTranslations("valuation");
  return { title: t("title") };
}

const TABS = ["price_check", "rates", "grades", "fees", "transfer_types", "owner_types"] as const;
/** Exemptions, appeals and assessments are no longer shown: their old links open the first tab. */
const OLD_TABS: Record<string, Tab> = {};
type Tab = (typeof TABS)[number];

export default async function ValuationPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "valuation.view");
  const t = await getTranslations("valuation");
  const lang = await getLocale();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : (OLD_TABS[sp.tab ?? ""] ?? "price_check");
  const badge: Partial<Record<Tab, number>> = {};

  let body: React.ReactNode = null;
  if (tab === "price_check") {
    const fees = await listFeeTypes();
    const service = fees.find((f) => f.code === "service_charge" && f.active);
    body = <PriceCheck grades={await listGrades()} serviceCharge={Number(service?.amount ?? 0)} />;
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
