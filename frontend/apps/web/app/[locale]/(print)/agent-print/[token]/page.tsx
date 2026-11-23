import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { InvoiceSheet, payQr } from "@/components/billing/invoice-sheet";
import { CertificateSheet } from "@/components/documents/certificate-sheet";
import { IdCardSheet } from "@/components/documents/id-card-sheet";
import { ReceiptSheet } from "@/components/payments/receipt-sheet";
import { loadAgentJob } from "@/lib/server/print-agent";

export const metadata = { robots: { index: false, follow: false } };

/**
 * The official sheet, opened only by the print program. Its one-time token is the only way in: the token works while
 * that job is printing and stops as soon as the job is reported.
 */
export default async function AgentPrintPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const job = await loadAgentJob(token);
  if (!job) notFound();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (job.kind === "receipt") {
    return (
      <div className="bg-white">
        <style>{"@page { size: 80mm auto; margin: 0 }"}</style>
        <ReceiptSheet r={job.receipt} />
      </div>
    );
  }
  if (job.kind === "invoice") {
    const payUrl = job.invoice.pay_link ? `${site}/${locale}${job.invoice.pay_link}` : null;
    return (
      <div className="bg-white">
        <style>{"@page { size: A4; margin: 0 }"}</style>
        <InvoiceSheet inv={job.invoice} payUrl={payUrl} qr={await payQr(payUrl)} servedBy={job.servedBy} />
      </div>
    );
  }
  const { doc } = job;
  const verifyUrl = `${site}/${locale}/verify/${doc.verify_code}`;
  return (
    <div className="bg-white">
      <style>{doc.type === "certificate" ? "@page { size: A4; margin: 0 }" : "@page { size: 85.6mm 54mm; margin: 0 }"}</style>
      {doc.type === "certificate" ? (
        <CertificateSheet doc={doc} verifyUrl={verifyUrl} watermarkFacts={job.facts} servedBy={job.servedBy} />
      ) : (
        <IdCardSheet doc={doc} verifyUrl={verifyUrl} servedBy={job.servedBy} agent={{ facts: job.facts, photoUrl: job.photoUrl, outlines: job.outlines }} />
      )}
    </div>
  );
}
