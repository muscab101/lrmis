"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const LAND_USES = ["residential", "commercial", "state", "mixed", "agricultural", "other"] as const;
const money = z.coerce.number().min(0, "validation.amount").max(10_000_000, "validation.amount");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const year = z.coerce.number().int().min(2000).max(2100);

/** Turn "VALIDATION: note_required" style RPC errors into a field error the dialog can show. */
function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(value: T) => {
  revalidatePath("/[locale]/valuation", "page");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return value;
};

const catalogItem = z.object({
  id: z.uuid().nullable(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/, "validation.code"),
  nameSo: z.string().trim().min(2, "validation.name").max(80),
  nameEn: z.string().trim().min(2, "validation.name").max(80),
  amount: money,
  active: z.boolean().default(true),
  sort: z.coerce.number().int().min(0).max(10_000).default(100),
});

export const saveGradeAction = defineAction("valuation.save_grade", catalogItem, async (v, ctx) => {
  try {
    unwrap(
      await ctx.supabase.rpc("valuation_save_grade", {
        p_id: v.id,
        p: { code: v.code, name_so: v.nameSo, name_en: v.nameEn, amount: v.amount, active: v.active, sort: v.sort },
      }),
      "save grade",
    );
  } catch (err) {
    field(err, { code_taken: "code" });
  }
  return done(null);
});

export const saveFeeTypeAction = defineAction(
  "valuation.save_fee_type",
  catalogItem.extend({ interval: z.enum(["monthly", "quarterly", "biannual", "annual", "one_off"]) }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("valuation_save_fee_type", {
          p_id: v.id,
          p: { code: v.code, name_so: v.nameSo, name_en: v.nameEn, interval: v.interval, amount: v.amount, active: v.active, sort: v.sort },
        }),
        "save fee type",
      );
    } catch (err) {
      field(err, { code_taken: "code" });
    }
    return done(null);
  },
);

/** Delete a fee type nobody uses; one already billed is switched off instead. Built-in ones are refused. */
export const deleteFeeTypeAction = defineAction("valuation.delete_fee_type", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("valuation_delete_fee_type", { p_id: id }), "delete fee type") as "deleted" | "hidden";
  return done({ result });
});

export const setRateAction = defineAction(
  "valuation.set_rate",
  z.object({
    neighbourhoodId: z.uuid("validation.required"),
    landUse: z.enum(LAND_USES),
    developed: z.boolean(),
    rate: money,
    serviceCharge: money,
    validFrom: isoDate,
    note: z.string().max(300).default(""),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("valuation_set_rate", {
          p_neighbourhood: v.neighbourhoodId,
          p_use: v.landUse,
          p_developed: v.developed,
          p_rate: v.rate,
          p_service: v.serviceCharge,
          p_valid_from: v.validFrom,
          p_note: v.note,
        }),
        "set rate",
      );
    } catch (err) {
      field(err, { rate_exists: "validFrom" });
    }
    return done(null);
  },
);

export const saveBuildingAction = defineAction(
  "valuation.save_building",
  z.object({
    id: z.uuid().nullable(),
    parcelId: z.uuid(),
    gradeId: z.uuid("validation.required"),
    units: z.coerce.number().int().min(1).max(500),
    floors: z.coerce.number().int().min(0).max(60),
    areaM2: z.coerce.number().positive().max(1_000_000).nullable(),
    use: z.string().max(60).default(""),
    note: z.string().max(300).default(""),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("building_save", {
        p_id: v.id,
        p_parcel: v.parcelId,
        p: { grade_id: v.gradeId, units: v.units, floors: v.floors, area_m2: v.areaM2 ?? "", use: v.use, note: v.note },
      }),
      "save building",
    );
    return done(null);
  },
);

export const removeBuildingAction = defineAction("valuation.remove_building", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  unwrap(await ctx.supabase.rpc("building_remove", { p_id: id }), "remove building");
  return done(null);
});

export const previewAssessmentAction = defineAction("valuation.preview", z.object({ parcelId: z.uuid(), year }), async (v, ctx) =>
  unwrap(await ctx.supabase.rpc("assessment_preview", { p_parcel: v.parcelId, p_year: v.year }), "preview"),
);

export const assessParcelAction = defineAction("valuation.assess", z.object({ parcelId: z.uuid(), year }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("assess_parcel", { p_parcel: v.parcelId, p_year: v.year }), "assess") as { assessment_id: string; total: number }),
);

export const assessNeighbourhoodAction = defineAction(
  "valuation.assess_neighbourhood",
  z.object({ neighbourhoodId: z.uuid("validation.required"), year }),
  async (v, ctx) =>
    done(unwrap(await ctx.supabase.rpc("assess_neighbourhood", { p_neighbourhood: v.neighbourhoodId, p_year: v.year }), "assess nbhd") as { assessed: number; skipped: number }),
);

export const requestExemptionAction = defineAction(
  "valuation.request_exemption",
  z.object({
    parcelId: z.uuid(),
    kind: z.enum(["mosque", "school", "hospital", "government", "hardship", "other"]),
    pct: z.coerce.number().gt(0, "validation.pct").max(100, "validation.pct"),
    reason: z.string().trim().min(3, "validation.reason").max(500),
    validFrom: isoDate,
    validTo: isoDate.nullable(),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("exemption_request", {
        p_parcel: v.parcelId,
        p_kind: v.kind,
        p_pct: v.pct,
        p_reason: v.reason,
        p_valid_from: v.validFrom,
        p_valid_to: v.validTo,
      }),
      "request exemption",
    );
    return done(null);
  },
);

export const decideExemptionAction = defineAction(
  "valuation.decide_exemption",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).default("") }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("exemption_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "decide exemption");
    } catch (err) {
      field(err, { note_required: "note" });
    }
    return done(null);
  },
);

export const fileAppealAction = defineAction(
  "valuation.file_appeal",
  z.object({ assessmentId: z.uuid(), reason: z.string().trim().min(10, "validation.reason_long").max(2000), requestedTotal: money.nullable() }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("appeal_file", { p_assessment: v.assessmentId, p_reason: v.reason, p_requested: v.requestedTotal }), "file appeal");
    return done(null);
  },
);

export const decideAppealAction = defineAction(
  "valuation.decide_appeal",
  z.object({ id: z.uuid(), status: z.enum(["upheld", "rejected", "withdrawn"]), newTotal: money.nullable(), note: z.string().max(1000).default("") }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("appeal_decide", { p_id: v.id, p_status: v.status, p_new_total: v.newTotal, p_note: v.note }), "decide appeal");
    } catch (err) {
      field(err, { note_required: "note", new_total: "newTotal" });
    }
    return done(null);
  },
);
