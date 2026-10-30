"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

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
    kind: z.enum(["sale", "gift", "inheritance", "court_order"]),
    value: z.coerce.number().min(0).max(1_000_000_000).nullable(),
    courtOrderId: z.uuid().nullable(),
    owners: z.array(z.object({ partyId: id, role: z.enum(["owner", "co_owner", "heir"]), share: z.coerce.number().gt(0).max(100) })).min(1, "validation.recipients"),
    note: note,
  }),
  async (v, ctx) => {
    let tid: string;
    try {
      tid = unwrap(await ctx.supabase.rpc("transfer_create", { p_parcel: v.parcelId, p_kind: v.kind, p_value: v.value, p_court_order: v.courtOrderId, p_note: v.note }), "transfer") as string;
    } catch (err) {
      field(err, { declared_value: "value", court_order: "courtOrderId" });
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
export const decideTransferAction = defineAction("transfers.decide", z.object({ id, approve: z.boolean(), note }), async (v, ctx) =>
  rpc(ctx, "transfer_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }),
);
export const cancelTransferAction = defineAction("transfers.cancel", z.object({ id, note }), async (v, ctx) => rpc(ctx, "transfer_cancel", { p_id: v.id, p_reason: v.note }));

// ---- Disputes, court orders, liens ----
export const openDisputeAction = defineAction(
  "disputes.open",
  z.object({
    parcelId: id,
    kind: z.enum(["boundary", "ownership", "inheritance", "other"]),
    description: z.string().trim().min(10, "validation.reason_long").max(2000),
    claimantName: z.string().trim().min(2, "validation.name").max(120),
    claimantPhone: z.string().max(20).default(""),
    courtCaseNo: z.string().max(60).default(""),
  }),
  async (v, ctx) =>
    rpc(ctx, "dispute_open", {
      p_parcel: v.parcelId,
      p: { kind: v.kind, description: v.description, claimant_name: v.claimantName, claimant_phone: v.claimantPhone, court_case_no: v.courtCaseNo },
    }),
);
export const closeDisputeAction = defineAction("disputes.close", z.object({ id, status: z.enum(["resolved", "dismissed"]), note }), async (v, ctx) =>
  rpc(ctx, "dispute_close", { p_id: v.id, p_status: v.status, p_resolution: v.note }),
);
export const addCourtOrderAction = defineAction(
  "disputes.order",
  z.object({
    parcelId: id,
    orderNo: z.string().trim().min(2, "validation.required").max(60),
    court: z.string().trim().min(2, "validation.required").max(120),
    orderDate: isoDate,
    kind: z.enum(["freeze", "transfer", "release", "other"]),
    description: z.string().trim().min(5, "validation.reason").max(1000),
  }),
  async (v, ctx) =>
    rpc(ctx, "court_order_add", { p_parcel: v.parcelId, p: { order_no: v.orderNo, court: v.court, order_date: v.orderDate, kind: v.kind, description: v.description } }),
);
export const liftCourtOrderAction = defineAction("disputes.lift", z.object({ id, note }), async (v, ctx) => rpc(ctx, "court_order_lift", { p_id: v.id, p_note: v.note }));
export const registerLienAction = defineAction(
  "disputes.lien",
  z.object({ parcelId: id, kind: z.enum(["mortgage", "lien", "caveat"]), holder: z.string().trim().min(2, "validation.name").max(120), amount: z.coerce.number().min(0).nullable(), reference: z.string().max(60).default("") }),
  async (v, ctx) => rpc(ctx, "lien_register", { p_parcel: v.parcelId, p: { kind: v.kind, holder: v.holder, amount: v.amount ?? "", reference: v.reference } }),
);
export const releaseLienAction = defineAction("disputes.release", z.object({ id, note }), async (v, ctx) => rpc(ctx, "lien_release", { p_id: v.id, p_note: v.note }));

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
      const { data } = await ctx.supabase.from("parcels").select("id, pun").in("pun", v.otherPuns.filter(Boolean).map((p) => p.toUpperCase().replace(/-/g, "")));
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

// ---- Permits ----
export const applyPermitAction = defineAction(
  "permits.apply",
  z.object({
    parcelId: id,
    kind: z.enum(["construction", "extension", "renovation", "demolition", "fence"]),
    description: z.string().trim().min(10, "validation.reason_long").max(2000),
    floors: z.coerce.number().int().min(0).max(60).nullable(),
    areaM2: z.coerce.number().positive().max(1_000_000).nullable(),
    applicantName: z.string().trim().min(2, "validation.name").max(120),
    applicantPhone: z.string().max(20).default(""),
  }),
  async (v, ctx) =>
    rpc(ctx, "permit_apply", {
      p_parcel: v.parcelId,
      p: { kind: v.kind, description: v.description, floors: v.floors ?? "", area_m2: v.areaM2 ?? "", applicant_name: v.applicantName, applicant_phone: v.applicantPhone },
    }),
);
export const decidePermitAction = defineAction("permits.decide", z.object({ id, approve: z.boolean(), conditions: z.string().max(1000).default(""), note }), async (v, ctx) =>
  rpc(ctx, "permit_decide", { p_id: v.id, p_approve: v.approve, p_conditions: v.conditions, p_note: v.note }),
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
