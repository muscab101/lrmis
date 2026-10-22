"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optionalPhone } from "@dhulka/core/schemas";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const text = (max: number) => z.string().trim().max(max, "validation.too_long").default("");
const reason = z.string().trim().min(5, "validation.reason").max(500, "validation.too_long");

function refresh() {
  revalidatePath("/[locale]/parcels", "layout");
}

/** Reason errors from the DB go under the reason field. */
function reasonError(err: unknown): never {
  if (err instanceof AppFailure && err.code === "VALIDATION" && err.values?.detail === "reason") {
    throw new AppFailure("VALIDATION", undefined, { reason: ["validation.reason"] });
  }
  throw err;
}

export const updateParcelDetailsAction = defineAction(
  "parcels.details",
  z.object({ id: z.uuid(), houseNo: text(40), govtReceiptNo: text(60), plotNo: text(40) }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_update_details", {
        p_id: v.id,
        p: { house_no: v.houseNo, govt_receipt_no: v.govtReceiptNo, plot_no: v.plotNo },
      }),
      "parcel details",
    );
    refresh();
    return null;
  },
);

export const lockParcelAction = defineAction("parcels.lock", z.object({ id: z.uuid(), reason }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("parcel_lock", { p_id: v.id, p_reason: v.reason }), "lock parcel");
  } catch (err) {
    reasonError(err);
  }
  refresh();
  return null;
});

export const unlockParcelAction = defineAction("parcels.unlock", z.object({ id: z.uuid(), reason }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("parcel_unlock", { p_id: v.id, p_reason: v.reason }), "unlock parcel");
  } catch (err) {
    reasonError(err);
  }
  refresh();
  return null;
});

const size = z.number({ error: "validation.plot_size" }).gt(0, "validation.plot_size").max(5000, "validation.plot_size");

/** A surveyor adds land found in the field: it goes to Parcels → Partial registration (no application yet). */
export const addFieldLandAction = defineAction(
  "parcels.field_land",
  z.object({
    districtId: z.uuid("validation.district"),
    neighbourhoodId: z.uuid().nullable().default(null),
    pinLon: z.number({ error: "validation.pin_required" }).min(40).max(52),
    pinLat: z.number({ error: "validation.pin_required" }).min(-2).max(12.5),
    pinAccuracyM: z.number().min(0).max(10_000).nullable().default(null),
    plotWidthM: size,
    plotLengthM: size,
    houseNo: text(40),
    propertyType: text(40),
    landUse: text(40),
    ownerName: z.string().trim().min(3, "validation.owner_name").max(200, "validation.too_long"),
    ownerPhone: optionalPhone,
    note: text(400),
  }),
  async (v, ctx) => {
    try {
      const out = unwrap(
        await ctx.supabase.rpc("field_land_create", {
          p: {
            district_id: v.districtId,
            neighbourhood_id: v.neighbourhoodId,
            pin_lon: v.pinLon,
            pin_lat: v.pinLat,
            pin_accuracy_m: v.pinAccuracyM,
            plot_width_m: v.plotWidthM,
            plot_length_m: v.plotLengthM,
            house_no: v.houseNo,
            property_type: v.propertyType,
            land_use: v.landUse,
            owner_name: v.ownerName,
            owner_phone: v.ownerPhone,
            note: v.note,
          },
        }),
        "field land",
      ) as { parcel_id: string };
      refresh();
      return out;
    } catch (err) {
      // Location and House No errors from the DB go under their fields.
      if (err instanceof AppFailure && err.code === "CONFLICT" && err.values?.detail === "house_no_taken") {
        throw new AppFailure("VALIDATION", err.values, { houseNo: ["validation.house_no_taken"] });
      }
      if (err instanceof AppFailure && err.code === "VALIDATION") {
        const detail = String(err.values?.detail ?? "");
        const field = detail.startsWith("pin") ? "pin" : detail.startsWith("neighbourhood") ? "neighbourhoodId" : detail === "plot_size" ? "plotWidthM" : "districtId";
        throw new AppFailure("VALIDATION", err.values, { [field]: [`validation.${detail}`] });
      }
      throw err;
    }
  },
);

/** Field land → a draft application (channel "field") for the bill, survey, verification and registration. */
export const startRegistrationAction = defineAction("parcels.start_registration", z.object({ parcelId: z.uuid() }), async ({ parcelId }, ctx) => {
  const out = unwrap(await ctx.supabase.rpc("field_land_start_registration", { p_parcel: parcelId }), "start registration") as { id: string; number: string };
  refresh();
  revalidatePath("/[locale]/applications", "layout");
  return out;
});
