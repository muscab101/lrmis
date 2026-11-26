"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const money = z.coerce.number().min(0, "validation.amount").max(10_000_000, "validation.amount");
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
  catalogItem.extend({
    interval: z.enum(["monthly", "quarterly", "biannual", "annual", "one_off"]),
    chargeOn: z.array(z.enum(["registration", "yearly", "transfer", "id_card"])).default([]),
    factors: z.array(z.enum(["area", "width", "length", "storeys", "floors", "units"])).default([]),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("valuation_save_fee_type", {
          p_id: v.id,
          p: { code: v.code, name_so: v.nameSo, name_en: v.nameEn, interval: v.interval, amount: v.amount, active: v.active, sort: v.sort, charge_on: v.chargeOn, factors: v.factors },
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

export const saveOwnerTypeAction = defineAction(
  "valuation.save_owner_type",
  z.object({ id: z.uuid().nullable(), nameSo: z.string().trim().min(2, "validation.name").max(80), nameEn: z.string().trim().min(2, "validation.name").max(80), active: z.boolean().default(true) }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("owner_type_save", { p_id: v.id, p: { name_so: v.nameSo, name_en: v.nameEn, active: v.active } }), "save owner type");
    } catch (err) {
      field(err, { owner_type_taken: "nameEn" });
    }
    return done(null);
  },
);

/** Delete an owner type nobody has; one in use is switched off instead. */
export const deleteOwnerTypeAction = defineAction("valuation.delete_owner_type", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("owner_type_delete", { p_id: id }), "delete owner type") as "deleted" | "hidden";
  return done({ result });
});

export const saveTransferTypeAction = defineAction(
  "valuation.save_transfer_type",
  z.object({
    id: z.uuid().nullable(),
    nameSo: z.string().trim().min(2, "validation.name").max(80),
    nameEn: z.string().trim().min(2, "validation.name").max(80),
    worksAs: z.enum(["sale", "gift", "inheritance", "court_order"]),
    duty: money,
    active: z.boolean().default(true),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("transfer_type_save", { p_id: v.id, p: { name_so: v.nameSo, name_en: v.nameEn, works_as: v.worksAs, duty: v.duty, active: v.active } }),
        "save transfer type",
      );
    } catch (err) {
      field(err, { transfer_type_taken: "nameEn", amount: "duty" });
    }
    revalidatePath("/[locale]/transfers", "page");
    return done(null);
  },
);

/** Delete a transfer type no transfer used; one that was used is switched off instead. */
export const deleteTransferTypeAction = defineAction("valuation.delete_transfer_type", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("transfer_type_delete", { p_id: id }), "delete transfer type") as "deleted" | "hidden";
  return done({ result });
});

export const saveBuildingTypeAction = defineAction(
  "valuation.save_building_type",
  z.object({
    id: z.uuid().nullable(),
    nameSo: z.string().trim().min(2, "validation.name").max(80),
    nameEn: z.string().trim().min(2, "validation.name").max(80),
    layout: z.enum(["house", "flats", "compound"]),
    gradeCode: z.string().trim().min(1, "validation.required").max(40),
    active: z.boolean().default(true),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("building_type_save", { p_id: v.id, p: { name_so: v.nameSo, name_en: v.nameEn, layout: v.layout, grade_code: v.gradeCode, active: v.active } }),
        "save building type",
      );
    } catch (err) {
      field(err, { building_type_taken: "nameEn", building_grade: "gradeCode", building_layout: "layout", name: "nameEn" });
    }
    return done(null);
  },
);

/** Delete a building type (land already saved keeps its kind and price). */
export const deleteBuildingTypeAction = defineAction("valuation.delete_building_type", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  unwrap(await ctx.supabase.rpc("building_type_delete", { p_id: id }), "delete building type");
  return done(null);
});

/** One neighbourhood's own prices by house type id (the Price check tab). */
export const neighbourhoodPricesAction = defineAction("valuation.neighbourhood_prices", z.object({ neighbourhoodId: z.uuid() }), async (v, ctx) => {
  const rows = unwrap(
    await ctx.supabase.from("neighbourhood_grade_prices").select("grade_id, amount").eq("neighbourhood_id", v.neighbourhoodId),
    "neighbourhood prices",
  ) as { grade_id: string; amount: number }[];
  return Object.fromEntries(rows.map((r) => [r.grade_id, Number(r.amount)])) as Record<string, number>;
});

/** Prices per house type for one neighbourhood: empty = the type's normal price there. */
export const saveNeighbourhoodPricesAction = defineAction(
  "valuation.save_neighbourhood_prices",
  z.object({
    neighbourhoodId: z.uuid("validation.required"),
    prices: z.array(z.object({ gradeId: z.uuid(), amount: z.coerce.number().min(0, "validation.amount").max(100_000, "validation.amount").nullable() })).max(200),
    /** Also set the unpaid bills of land there with these (changed) house types to the new price. */
    rebillGradeIds: z.array(z.uuid()).max(200).default([]),
  }),
  async (v, ctx) => {
    const count = unwrap(
      await ctx.supabase.rpc("neighbourhood_grade_prices_save", {
        p_neighbourhood: v.neighbourhoodId,
        p_prices: v.prices.map((x) => ({ grade_id: x.gradeId, amount: x.amount ?? "" })),
      }),
      "neighbourhood prices",
    ) as number;
    const rebilled = v.rebillGradeIds.length
      ? (unwrap(await ctx.supabase.rpc("neighbourhood_rebill", { p_neighbourhood: v.neighbourhoodId, p_grades: v.rebillGradeIds }), "rebill") as {
          changed: number;
          same: number;
          paid_more: number;
        })
      : null;
    return done({ count, rebilled });
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

// --- Edit and delete on the Valuation tabs ---------------------------------

/** Delete a grade nobody uses; one used by land or buildings is switched off. */
export const deleteGradeAction = defineAction("valuation.delete_grade", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("valuation_delete_grade", { p_id: id }), "delete grade") as "deleted" | "hidden";
  return done({ result });
});

