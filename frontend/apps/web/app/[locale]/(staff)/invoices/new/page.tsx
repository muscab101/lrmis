import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SingleInvoiceForm } from "@/components/billing/single-invoice-form";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: t("singleInvoiceTitle") };
}

export default async function SingleInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "invoices.create");
  const t = await getTranslations("billing");
  const supabase = await createClient();
  // Yearly property tax comes from billing runs; everything else can be billed one at a time.
  const { data } = await supabase.from("fee_types").select("id, code, name_so, name_en, amount, interval").eq("active", true).neq("code", "property_tax").order("sort");
  // One-off fees (certificate, survey, permit…) first; yearly ones after.
  const fees = ((data ?? []) as { id: string; code: string; name_so: string; name_en: string; amount: number; interval: string }[]).sort(
    (a, b) => Number(a.interval !== "one_off") - Number(b.interval !== "one_off"),
  );
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("singleInvoiceTitle")} description={t("singleInvoiceSubtitle")} />
      <SingleInvoiceForm fees={fees} />
    </div>
  );
}
