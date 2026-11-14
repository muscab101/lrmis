import { notFound } from "next/navigation";
import { getLocale, setRequestLocale } from "next-intl/server";
import { CertificateSheet } from "@/components/documents/certificate-sheet";
import { CertificateLocked } from "@/components/documents/certificate-locked";
import { IdCardSheet } from "@/components/documents/id-card-sheet";
import { OpenInApp } from "@/components/documents/open-in-app";
import { ScreenshotShield } from "@/components/documents/screenshot-shield";
import { certificateHidden, inDesktopApp } from "@/lib/server/desktop";
import { PrintControls } from "@/components/documents/print-controls";
import { requirePermission } from "@/lib/server/auth";
import { awaitingCardPayment, cardPrintPayments, getDocument } from "@/lib/server/certificates";
import { printerChoices } from "@/lib/server/printers";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDocument(id);
  return { title: d?.serial ?? "404" };
}

export default async function DocumentPrintPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.view");
  const lang = await getLocale();
  const d = await getDocument(id);
  if (!d) notFound();
  // Shown only inside the protected desktop app (when that is switched on).
  const inApp = await inDesktopApp();
  if (await certificateHidden())
    return (
      <div className="min-h-dvh bg-neutral-100 px-4 py-16">
        <OpenInApp serial={d.serial} />
      </div>
    );
  // An ID card prints only once its print bill is paid (when the card fee is on): check before printing.
  const pay = d.type === "id_card" && d.print_count === 0 ? (await cardPrintPayments([d.id])).get(d.id) : undefined;
  const canPrint = viewer.can("certificates.print");
  const printers = canPrint ? await printerChoices(d.district_id) : [];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const verifyUrl = `${site}/${lang}/verify/${d.verify_code}`;
  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <style>{d.type === "certificate" ? "@page { size: A4; margin: 0 }" : "@page { size: 85.6mm 54mm; margin: 0 }"}</style>
      <PrintControls id={d.id} printed={d.print_count > 0} status={d.status} canPrint={canPrint} printers={printers} payment={awaitingCardPayment(pay) ? { invoiceNumber: pay!.invoiceNumber } : null}>
        <ScreenshotShield off={inApp}>
          <div className="shadow-sm print:shadow-none">{d.type === "certificate" ? (viewer.can("certificates.design") ? <CertificateSheet doc={d} verifyUrl={verifyUrl} /> : <CertificateLocked serial={d.serial} />) : <IdCardSheet doc={d} verifyUrl={verifyUrl} />}</div>
        </ScreenshotShield>
      </PrintControls>
    </div>
  );
}
