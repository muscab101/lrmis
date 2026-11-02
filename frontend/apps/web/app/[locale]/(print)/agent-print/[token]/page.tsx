import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { CertificateSheet } from "@/components/documents/certificate-sheet";
import { IdCardSheet } from "@/components/documents/id-card-sheet";
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
  const { doc } = job;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const verifyUrl = `${site}/${locale}/verify/${doc.verify_code}`;
  return (
    <div className="bg-white">
      <style>{doc.type === "certificate" ? "@page { size: A4; margin: 0 }" : "@page { size: 85.6mm 54mm; margin: 0 }"}</style>
      {doc.type === "certificate" ? (
        <CertificateSheet doc={doc} verifyUrl={verifyUrl} watermarkFacts={job.facts} />
      ) : (
        <IdCardSheet doc={doc} verifyUrl={verifyUrl} agent={{ facts: job.facts, photoUrl: job.photoUrl, outlines: job.outlines }} />
      )}
    </div>
  );
}
