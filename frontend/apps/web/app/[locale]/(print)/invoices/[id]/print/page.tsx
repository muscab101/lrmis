import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { InvoicePrintNow } from "@/components/billing/invoice-print-now";
import { InvoiceSheet, payQr } from "@/components/billing/invoice-sheet";
import { requirePermission } from "@/lib/server/auth";
import { getInvoice, getPayLink, parcelOwnersFor } from "@/lib/server/billing";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await getInvoice(id);
  return { title: inv?.number ?? "404" };
}

/** The A4 invoice on screen. Paper comes from the printer at this person's point of sale (Print sends it there). */
export default async function InvoicePrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "invoices.print");
  const t = await getTranslations("documents");
  const lang = await getLocale();
  const inv = await getInvoice(id);
  if (!inv) notFound();
  const [link, owners] = await Promise.all([getPayLink(inv.id), inv.parcel ? parcelOwnersFor(inv.parcel.id) : []]);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const payUrl = link ? `${site}/${lang}${link}` : null;

  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end print:hidden">
        {inv.status !== "cancelled" && <InvoicePrintNow id={inv.id} variant="default" />}
      </div>
      <p className="hidden p-8 text-center text-lg print:block">{t("browserPrintOff")}</p>
      <div className="print:hidden">
        <InvoiceSheet
          inv={{
            ...inv,
            lines: inv.invoice_lines,
            owners: owners.map((o) => ({ share_pct: o.share_pct, full_name: o.party?.full_name ?? null })),
            parcel: inv.parcel ? { pun: inv.parcel.pun, account_no: inv.parcel.account_no, neighbourhood: inv.parcel.neighbourhood ?? null, district: inv.parcel.district ?? null } : null,
          }}
          payUrl={payUrl}
          qr={await payQr(payUrl)}
        />
      </div>
    </div>
  );
}
