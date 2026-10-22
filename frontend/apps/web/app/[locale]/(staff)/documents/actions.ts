"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  revalidatePath("/[locale]/documents", "layout");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return v;
};

export const issueCertificateAction = defineAction("certificates.issue", z.object({ parcelId: z.uuid() }), async ({ parcelId }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("certificate_issue", { p_parcel: parcelId }), "issue") as { certificate_id: string; id_cards: number }),
);

export const printDocumentAction = defineAction("certificates.print", z.object({ id: z.uuid() }), async ({ id }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("document_print", { p_id: id }), "print") as { serial: string; print_count: number }),
);

export const requestReprintAction = defineAction("certificates.reprint", z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }), async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("reprint_request", { p_id: v.id, p_reason: v.reason }), "reprint") as { request_id: string; fee_invoice_id: string | null });
  } catch (err) {
    field(err, { reason: "reason" });
  }
});

export const decideReprintAction = defineAction("certificates.decide_reprint", z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("reprint_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "decide") as { status: string; document_id?: string });
  } catch (err) {
    field(err, { note_required: "note" });
  }
});

export const cancelDocumentAction = defineAction("certificates.cancel", z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("document_cancel", { p_id: v.id, p_reason: v.reason }), "cancel");
  return done(null);
});

export const requestReissueAction = defineAction("certificates.reissue", z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(500) }), async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("reissue_request", { p_id: v.id, p_reason: v.reason }), "reissue") as { request_id: string });
  } catch (err) {
    field(err, { reason: "reason" });
  }
});

/** Super admin: reprint now without a second person or a fee. An empty reason reuses a pending request's. */
export const reprintDirectAction = defineAction("certificates.reprint_direct", z.object({ id: z.uuid(), reason: z.string().trim().max(500).default("") }), async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("reprint_direct", { p_id: v.id, p_reason: v.reason }), "reprint") as { status: string; document_id: string });
  } catch (err) {
    field(err, { reason: "reason" });
  }
});

export interface BulkIssueResult {
  issued: number;
  id_cards: number;
  failed: { parcel_id: string; pun: string | null; error: string }[];
}

export const issueBulkAction = defineAction("certificates.issue_bulk", z.object({ parcelIds: z.array(z.uuid()).min(1).max(100) }), async ({ parcelIds }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("certificate_issue_bulk", { p_parcels: parcelIds }), "issue") as BulkIssueResult),
);

export const printBulkAction = defineAction("certificates.print_bulk", z.object({ ids: z.array(z.uuid()).min(1).max(100) }), async ({ ids }, ctx) =>
  done(unwrap(await ctx.supabase.rpc("document_print_bulk", { p_ids: ids }), "print") as { printed: string[]; failed: { id: string; serial: string | null; error: string }[] }),
);
