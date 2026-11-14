import { Alert, Mono } from "@dhulka/ui/misc";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { BatchPrintControls } from "@/components/documents/print-controls";
import { CertificateSheet } from "@/components/documents/certificate-sheet";
import { CertificateLocked } from "@/components/documents/certificate-locked";
import { IdCardSheet } from "@/components/documents/id-card-sheet";
import { OpenInApp } from "@/components/documents/open-in-app";
import { requirePermission } from "@/lib/server/auth";
import { certificateHidden } from "@/lib/server/desktop";
import { awaitingCardPayment, cardPrintPayments, type DocumentDetail, getDocument } from "@/lib/server/certificates";
import { printerChoices } from "@/lib/server/printers";

export async function generateMetadata() {
  const t = await getTranslations("documents");
  return { title: t("batchTitle") };
}

/** Several documents in one print run: certificates on A4, ID cards on card-size pages (CSS named pages). */
export default async function BatchPrintPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ ids?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "certificates.view");
  // Shown only inside the protected desktop app (when that is switched on).
  if (await certificateHidden())
    return (
      <div className="min-h-dvh bg-neutral-100 px-4 py-16">
        <OpenInApp />
      </div>
    );
  const t = await getTranslations("documents");
  const lang = await getLocale();
  const ids = [...new Set((await searchParams).ids?.split(",") ?? [])].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  const docs = (await Promise.all(ids.map((id) => getDocument(id)))).filter((d): d is DocumentDetail => d !== null);
  const pays = await cardPrintPayments(docs.filter((d) => d.type === "id_card").map((d) => d.id));
  const unpaid = docs.filter((d) => d.status === "valid" && d.print_count === 0 && awaitingCardPayment(pays.get(d.id)));
  const ready = docs.filter((d) => d.status === "valid" && d.print_count === 0 && !unpaid.includes(d));
  const skipped = docs.filter((d) => !ready.includes(d) && !unpaid.includes(d));
  const canPrint = viewer.can("certificates.print");
  const printers = canPrint ? await printerChoices() : [];
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return (
    <div className="min-h-dvh bg-neutral-100 py-8 print:bg-white print:py-0">
      <style>{`@page cert { size: A4; margin: 0 } @page card { size: 85.6mm 54mm; margin: 0 }
        .sheet-cert { page: cert; break-after: page } .sheet-card { page: card; break-after: page }
        .sheet-card section { break-after: page }`}</style>
      {unpaid.length > 0 && (
        <Alert tone="warning" title={t("batchUnpaid", { count: unpaid.length })} className="mx-auto mb-4 max-w-[210mm] print:hidden">
          {unpaid.map((d) => (
            <Mono key={d.id} className="me-2">
              {d.serial}
            </Mono>
          ))}
        </Alert>
      )}
      {skipped.length > 0 && (
        <Alert tone="warning" title={t("batchSkipped", { count: skipped.length })} className="mx-auto mb-4 max-w-[210mm] print:hidden">
          {skipped.map((d) => (
            <Mono key={d.id} className="me-2">
              {d.serial}
            </Mono>
          ))}
        </Alert>
      )}
      <BatchPrintControls ids={ready.map((d) => d.id)} canPrint={canPrint} printers={printers}>
        <div className="space-y-8 print:space-y-0">
          {await Promise.all(
            ready.map(async (d) => {
              const verifyUrl = `${site}/${lang}/verify/${d.verify_code}`;
              return (
                <div key={d.id} className={`shadow-sm print:shadow-none ${d.type === "certificate" ? "sheet-cert" : "sheet-card"}`}>
                  {d.type === "certificate"
                    ? viewer.can("certificates.design")
                      ? await CertificateSheet({ doc: d, verifyUrl })
                      : <CertificateLocked serial={d.serial} />
                    : await IdCardSheet({ doc: d, verifyUrl })}
                </div>
              );
            }),
          )}
        </div>
      </BatchPrintControls>
    </div>
  );
}
