import "server-only";
import type { NextRequest } from "next/server";
import type { InvoiceSheetData } from "@/components/billing/invoice-sheet";
import type { ReceiptSheetData } from "@/components/payments/receipt-sheet";
import type { banadirOutlines, DocumentDetail, WatermarkFacts } from "@/lib/server/certificates";
import { PARTY_PHOTO_BUCKET } from "@/lib/server/party-photo";
import { createAdminClient, createIsolatedClient } from "@/lib/supabase/admin";

/** The print program's secret key, from its Authorization header. */
export function agentKey(req: NextRequest): string | null {
  const m = /^Bearer\s+(\S{10,200})$/.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]! : null;
}

/** The address the print program connects from. Only used for alerts, never to let it in. */
export function agentIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 45) || req.headers.get("x-real-ip")?.slice(0, 45) || null;
}

/** What a job prints (a document, or an invoice), or null when the one-time token no longer works. */
export async function loadAgentJob(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data } = await createIsolatedClient().rpc("agent_job_document", { p_token: token });
  if (!data) return null;
  if ((data as { receipt?: unknown }).receipt) {
    return { kind: "receipt" as const, receipt: (data as { receipt: ReceiptSheetData }).receipt };
  }
  if ((data as { invoice?: unknown }).invoice) {
    return { kind: "invoice" as const, invoice: (data as { invoice: InvoiceSheetData & { pay_link: string | null } }).invoice };
  }
  const job = data as { doc: DocumentDetail; facts: WatermarkFacts; photo_path: string | null; outlines: Awaited<ReturnType<typeof banadirOutlines>> | null };
  const photoUrl = job.photo_path ? ((await (await createAdminClient()).storage.from(PARTY_PHOTO_BUCKET).createSignedUrl(job.photo_path, 600)).data?.signedUrl ?? null) : null;
  return { kind: "document" as const, doc: job.doc, facts: job.facts, photoUrl, outlines: job.outlines ?? [] };
}
