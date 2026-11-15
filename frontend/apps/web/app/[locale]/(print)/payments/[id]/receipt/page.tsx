import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReceiptSheet } from "@/components/payments/receipt-sheet";
import { PrintButton } from "@/app/[locale]/(print)/invoices/[id]/print/print-button";
import { requirePermission } from "@/lib/server/auth";
import { getPayment } from "@/lib/server/payments";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPayment(id);
  return { title: p?.receipt_no ?? "404" };
}

/** Narrow receipt (fits 80 mm thermal printers and A4). */
export default async function ReceiptPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "payments.print");
  const t = await getTranslations("payments");
  const p = await getPayment(id);
  if (!p) notFound();
  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[80mm] justify-end print:hidden">
        <PrintButton label={t("print")} />
      </div>
      <ReceiptSheet
        r={{
          receipt_no: p.receipt_no,
          received_at: p.received_at,
          pos: p.pos?.name ?? null,
          pun: p.parcel?.pun ?? null,
          payer_name: p.payer_name,
          method: p.method,
          reference: p.reference,
          allocations: p.payment_allocations.map((a) => ({ id: a.id, number: a.invoice?.number ?? null, amount: Number(a.amount) })),
          unallocated: Number(p.unallocated),
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
        }}
      />
    </div>
  );
}
