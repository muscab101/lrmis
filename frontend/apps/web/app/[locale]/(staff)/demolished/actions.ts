"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap } from "@/lib/server/action";
import { placeChoices } from "@/lib/server/billing";

const refresh = () => {
  revalidatePath("/[locale]/demolished", "page");
  revalidatePath("/[locale]/parcels", "page");
};
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.demolish_date");

export const demolitionPlacesAction = defineAction(
  "demolitions.places",
  z.object({
    d: z.string().optional(),
    s: z.string().optional(),
    k: z.string().optional(),
    locale: z.string().max(5),
  }),
  async (v) => placeChoices(v, v.locale),
);

export interface DemolitionCandidate {
  id: string;
  pun: string | null;
  house_no: string | null;
  layout: string;
  area_m2: number | null;
  owners: string | null;
  neighbourhood: string | null;
  district: string;
  balance: number;
}

export const demolitionCandidatesAction = defineAction(
  "demolitions.candidates",
  z.object({
    d: z.uuid().nullable(),
    s: z.uuid().nullable(),
    k: z.uuid().nullable(),
    n: z.uuid().nullable(),
    q: z.string().trim().max(60),
  }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("demolition_candidates", {
        p_district: v.d,
        p_section: v.s,
        p_sector: v.k,
        p_neighbourhood: v.n,
        p_q: v.q,
        p_limit: 1000,
      }),
      "demolition candidates",
    ) as DemolitionCandidate[],
);

export const demolitionRequestAction = defineAction(
  "demolitions.request",
  z.object({
    parcelIds: z.array(z.uuid()).min(1, "validation.demolish_selection").max(1000),
    date: isoDay,
    reason: z.string().trim().min(5, "validation.reason").max(1000),
    notes: z.string().trim().max(2000).default(""),
    demolishedBy: z.string().trim().max(200).default(""),
    approveNow: z.boolean(),
  }),
  async (v, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("demolition_request", {
        p: {
          parcel_ids: v.parcelIds,
          demolition_date: v.date,
          reason: v.reason,
          notes: v.notes,
          demolished_by: v.demolishedBy,
          approve_now: v.approveNow,
        },
      }),
      "demolition request",
    ) as { count: number; approved: boolean };
    refresh();
    return out;
  },
);

export const demolitionDecideAction = defineAction(
  "demolitions.decide",
  z.object({
    ids: z.array(z.uuid()).min(1).max(1000),
    approve: z.boolean(),
    note: z.string().trim().max(1000).default(""),
  }),
  async (v, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("demolition_decide", {
        p_ids: v.ids,
        p_approve: v.approve,
        p_note: v.note,
      }),
      "demolition decide",
    );
    refresh();
    return out;
  },
);

export const demolitionRestoreAction = defineAction(
  "demolitions.restore",
  z.object({ id: z.uuid(), reason: z.string().trim().min(5, "validation.reason").max(1000) }),
  async (v, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("demolition_restore", { p_id: v.id, p_reason: v.reason }),
      "demolition restore",
    );
    refresh();
    return out;
  },
);

/** Undo many at once (a whole neighbourhood marked by mistake). Returns how many were put back. */
export const demolitionRestoreManyAction = defineAction(
  "demolitions.restore_many",
  z.object({
    ids: z.array(z.uuid()).min(1, "validation.demolish_selection").max(2000),
    reason: z.string().trim().min(5, "validation.reason").max(1000),
  }),
  async (v, ctx) => {
    const n = unwrap(
      await ctx.supabase.rpc("demolition_restore_many", { p_ids: v.ids, p_reason: v.reason }),
      "demolition restore many",
    ) as number;
    refresh();
    return { count: n };
  },
);

export const demolitionReregisterAction = defineAction(
  "demolitions.reregister",
  z.object({
    id: z.uuid(),
    keepOwner: z.boolean(),
    ownerName: z.string().trim().max(200).default(""),
    ownerPhone: z.string().trim().max(30).default(""),
    propertyType: z.string().trim().min(1, "validation.property_type").max(40),
    houseNo: z.string().trim().max(40).default(""),
    note: z.string().trim().max(400).default(""),
  }),
  async (v, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("demolition_reregister", {
        p_id: v.id,
        p: {
          keep_owner: v.keepOwner,
          owner_name: v.ownerName,
          owner_phone: v.ownerPhone,
          property_type: v.propertyType,
          house_no: v.houseNo,
          note: v.note,
        },
      }),
      "register again",
    ) as { building_no: string; pun: string; parcel_id: string };
    refresh();
    return out;
  },
);
