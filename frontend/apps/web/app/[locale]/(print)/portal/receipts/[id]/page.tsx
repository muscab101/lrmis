import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReceiptSheet } from "@/components/payments/receipt-sheet";
import { PrintButton } from "@/app/[locale]/(print)/invoices/[id]/print/print-button";
import { Link } from "@/i18n/navigation";
import { requireCitizen } from "@/lib/server/auth";
import { citizenReceipt } from "@/lib/server/portal";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await citizenReceipt(id);
  return { title: p?.receipt_no ?? "404" };
}

/** A citizen's own receipt: view it and print it (fits 80 mm printers and A4). */
export default async function CitizenReceiptPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireCitizen(locale);
  const t = await getTranslations("payments");
  const tp = await getTranslations("portal");
  const p = await citizenReceipt(id);
  if (!p) notFound();
  // Served by: the cashier who took the payment (none for money paid online).
  const servedBy = p.created_by ? ((await (await createClient()).rpc("staff_name", { p_user: p.created_by })).data as string | null) : null;
  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[80mm] items-center justify-between print:hidden">
        <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm text-neutral-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {tp("backToMyLand")}
        </Link>
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
          served_by: servedBy,
        }}
      />
    </div>
  );
}
