"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { normalizePun } from "@/lib/pun";
import { log } from "@/lib/server/log";
import { TRANSFER_DOCS_BUCKET, TRANSFER_DOC_EXT, TRANSFER_DOC_MAX } from "@/lib/server/transfer-documents";
import { createAdminClient } from "@/lib/supabase/admin";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const note = z.string().max(1000).default("");
const id = z.uuid();

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  for (const p of ["transfers", "disputes", "permits", "parcels"]) revalidatePath(`/[locale]/${p}`, "layout");
  return v;
};

const rpc = async (ctx: { supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>> }, name: string, args: Record<string, unknown>, map: Record<string, string> = {}) => {
  try {
    return done(unwrap(await ctx.supabase.rpc(name, args), name));
  } catch (err) {
    field(err, { note_required: "note", ...map });
  }
};

// ---- Transfers ----
export const createTransferAction = defineAction(
  "transfers.create",
  z.object({
    parcelId: id,
    typeId: z.uuid("validation.required"),
    courtOrderId: z.uuid().nullable(),
    owners: z.array(z.object({ partyId: id, role: z.enum(["owner", "co_owner", "heir"]), share: z.coerce.number().gt(0).max(100) })).min(1, "validation.recipients"),
    note: note,
  }),
  async (v, ctx) => {
    let tid: string;
    try {
      tid = unwrap(
        await ctx.supabase.rpc("transfer_create_typed", { p_parcel: v.parcelId, p_type: v.typeId, p_court_order: v.courtOrderId, p_note: v.note }),
        "transfer",
      ) as string;
    } catch (err) {
      field(err, { transfer_type: "typeId", court_order: "courtOrderId" });
    }
    try {
      unwrap(
        await ctx.supabase.rpc("transfer_set_recipients", { p_id: tid, p_owners: v.owners.map((o) => ({ party_id: o.partyId, role: o.role, share_pct: o.share })) }),
        "recipients",
      );
    } catch (err) {
      await ctx.supabase.rpc("transfer_cancel", { p_id: tid, p_reason: "Recipients invalid at creation" });
      field(err, { shares_total: "owners", recipients: "owners" });
    }
    return done({ id: tid });
  },
);

export const submitTransferAction = defineAction("transfers.submit", z.object({ id }), async (v, ctx) => rpc(ctx, "transfer_submit", { p_id: v.id }));
export const cancelTransferAction = defineAction("transfers.cancel", z.object({ id, note }), async (v, ctx) => rpc(ctx, "transfer_cancel", { p_id: v.id, p_reason: v.note }));

/** Attach one document (PDF, Word, Excel, a photo…) to a transfer. */
export async function uploadTransferDocumentAction(form: FormData) {
  const handler = defineAction("transfers.document_add", z.object({ transferId: id }), async ({ transferId }, ctx) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppFailure("VALIDATION", undefined, { documents: ["validation.required"] });
    if (file.size > TRANSFER_DOC_MAX) throw new AppFailure("VALIDATION", undefined, { documents: ["validation.document_too_big"] });
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!TRANSFER_DOC_EXT.includes(ext)) throw new AppFailure("VALIDATION", undefined, { documents: ["validation.document_type"] });
    const path = `${transferId}/${crypto.randomUUID()}.${ext}`;
    const admin = await createAdminClient();
    const up = await admin.storage.from(TRANSFER_DOCS_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) throw new Error(`transfer document upload: ${up.error.message}`);
    const res = await ctx.supabase.rpc("transfer_document_add", { p_transfer: transferId, p_path: path, p_name: file.name, p_mime: file.type || "application/octet-stream", p_size: file.size });
    if (res.error) {
      const rm = await admin.storage.from(TRANSFER_DOCS_BUCKET).remove([path]);
      if (rm.error) log("error", "transfers.document_cleanup_failed", { requestId: ctx.requestId, path });
      unwrap(res, "transfer document");
    }
    return done({ id: res.data as string });
  });
  return handler({ transferId: String(form.get("transferId") ?? "") });
}

/** Remove a document from a transfer that is still a draft. */
export const removeTransferDocumentAction = defineAction("transfers.document_remove", z.object({ id }), async (v, ctx) => {
  const path = unwrap(await ctx.supabase.rpc("transfer_document_remove", { p_id: v.id }), "transfer document") as string;
  const admin = await createAdminClient();
  const rm = await admin.storage.from(TRANSFER_DOCS_BUCKET).remove([path]);
  if (rm.error) log("error", "transfers.document_cleanup_failed", { requestId: ctx.requestId, path });
  return done(null);
});

// ---- Parcel changes ----
export const requestChangeAction = defineAction(
  "parcels.change",
  z.object({
    kind: z.enum(["subdivide", "merge", "change_of_use", "correction"]),
    parcelIds: z.array(id).min(1),
    otherPuns: z.array(z.string().trim().max(40)).default([]),
    landUse: z.enum(["residential", "commercial", "state", "mixed", "agricultural", "other"]).nullable().default(null),
    children: z.array(z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) })).default([]),
    /** Subdivide: the owners of each new parcel, in the same order as children (an empty list keeps the current owners). */
    childOwners: z.array(z.array(id).max(20)).default([]),
    correction: z
      .object({
        plot_no: z.string().trim().max(40).optional(),
        deed_no: z.string().trim().max(60).optional(),
        govt_file_no: z.string().trim().max(60).optional(),
        ownership: z.enum(["public", "private"]).optional(),
        developed: z.boolean().optional(),
        geom: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }).optional(),
      })
      .default({}),
    reason: z.string().trim().min(5, "validation.reason").max(1000),
  }),
  async (v, ctx) => {
    let ids = v.parcelIds;
    if (v.kind === "merge" && v.otherPuns.length) {
      const { data } = await ctx.supabase.from("parcels").select("id, pun").in("pun", v.otherPuns.filter(Boolean).map(normalizePun));
      const found = (data ?? []) as { id: string }[];
      if (found.length !== v.otherPuns.filter(Boolean).length) throw new AppFailure("VALIDATION", undefined, { otherPuns: ["validation.pun_not_found"] });
      ids = [...ids, ...found.map((p) => p.id)];
    }
    const payload =
      v.kind === "change_of_use" ? { land_use: v.landUse } : v.kind === "subdivide" ? { children: v.children, ...(v.childOwners.length ? { owners: v.childOwners } : {}) } : v.kind === "correction" ? v.correction : {};
    return rpc(ctx, "parcel_change_request", { p_kind: v.kind, p_parcels: ids, p_payload: payload, p_reason: v.reason }, {
      land_use: "landUse",
      merge_owners: "otherPuns",
      merge_not_touching: "otherPuns",
      merge_neighbourhood: "otherPuns",
      children_overlap: "children",
      children_area: "children",
      child_outside: "children",
      child_invalid: "children",
      children: "children",
      child_owners: "children",
      pun_taken: "children",
      correction_empty: "correction",
      still_overlapping: "children",
      outside_neighbourhood: "children",
    });
  },
);
export const decideChangeAction = defineAction("parcels.decide_change", z.object({ id, approve: z.boolean(), note }), async (v, ctx) =>
  rpc(ctx, "parcel_change_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }),
);

// ---- Leases ----
export const createLeaseAction = defineAction(
  "parcels.lease",
  z.object({ parcelId: id, lesseeId: z.uuid("validation.required"), start: isoDate, end: isoDate, rent: z.coerce.number().min(0, "validation.amount"), purpose: z.string().max(300).default("") }),
  async (v, ctx) =>
    rpc(ctx, "lease_create", { p_parcel: v.parcelId, p_lessee: v.lesseeId, p_start: v.start, p_end: v.end, p_rent: v.rent, p_purpose: v.purpose }, { lease_terms: "end", lessee: "lesseeId" }),
);
export const endLeaseAction = defineAction("parcels.end_lease", z.object({ id, terminate: z.boolean(), note }), async (v, ctx) =>
  rpc(ctx, "lease_end", { p_id: v.id, p_terminate: v.terminate, p_note: v.note }),
);
