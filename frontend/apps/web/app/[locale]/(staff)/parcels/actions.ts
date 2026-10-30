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

export const lockParcelAction = defineAction(
  "parcels.lock",
  z.object({ id: z.uuid(), reason }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("parcel_lock", { p_id: v.id, p_reason: v.reason }),
        "lock parcel",
      );
    } catch (err) {
      reasonError(err);
    }
    refresh();
    return null;
  },
);

export const unlockParcelAction = defineAction(
  "parcels.unlock",
  z.object({ id: z.uuid(), reason }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("parcel_unlock", { p_id: v.id, p_reason: v.reason }),
        "unlock parcel",
      );
    } catch (err) {
      reasonError(err);
    }
    refresh();
    return null;
  },
);

const size = z
  .number({ error: "validation.plot_size" })
  .gt(0, "validation.plot_size")
  .max(5000, "validation.plot_size");

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
    /** An owner already entered with the full owner form (from a survey zone); else a new one from the name and phone. */
    ownerId: z.uuid().nullable().default(null),
    ownerName: z.string().trim().max(200, "validation.too_long").default(""),
    ownerPhone: optionalPhone,
    note: text(400),
  }),
  async (v, ctx) => {
    // Without an owner from the owner form, a name is needed.
    if (v.ownerId === null && v.ownerName.length < 3)
      throw new AppFailure("VALIDATION", undefined, { ownerName: ["validation.owner_name"] });
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
            owner_id: v.ownerId,
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
      if (
        err instanceof AppFailure &&
        err.code === "CONFLICT" &&
        err.values?.detail === "house_no_taken"
      ) {
        throw new AppFailure("VALIDATION", err.values, { houseNo: ["validation.house_no_taken"] });
      }
      if (err instanceof AppFailure && err.code === "VALIDATION") {
        const detail = String(err.values?.detail ?? "");
        const field = detail.startsWith("pin")
          ? "pin"
          : detail.startsWith("neighbourhood")
            ? "neighbourhoodId"
            : detail === "plot_size"
              ? "plotWidthM"
              : "districtId";
        throw new AppFailure("VALIDATION", err.values, { [field]: [`validation.${detail}`] });
      }
      throw err;
    }
  },
);

/**
 * The House No choices: 01 up to the neighbourhood's capacity, and the numbers other land there already has. The
 * neighbourhood comes from itself, a parcel being edited or a survey (its application); their own number is not taken.
 */
export const houseNumberChoicesAction = defineAction(
  "parcels.house_numbers",
  z.object({ neighbourhoodId: z.uuid().nullable().default(null), parcelId: z.uuid().nullable().default(null), surveyId: z.uuid().nullable().default(null) }),
  async (v, ctx) => {
    let neighbourhoodId = v.neighbourhoodId;
    let applicationId: string | null = null;
    let own: string | null = null;
    if (v.parcelId) {
      const { data } = await ctx.supabase.from("parcels").select("neighbourhood_id, house_no, application_id").eq("id", v.parcelId).maybeSingle();
      const p = data as { neighbourhood_id: string | null; house_no: string | null; application_id: string | null } | null;
      neighbourhoodId = p?.neighbourhood_id ?? null;
      applicationId = p?.application_id ?? null;
      own = p?.house_no ?? null;
    } else if (v.surveyId) {
      const { data } = await ctx.supabase.from("surveys").select("application:applications(id, neighbourhood_id)").eq("id", v.surveyId).maybeSingle();
      const a = (data as { application: { id: string; neighbourhood_id: string | null } | null } | null)?.application;
      neighbourhoodId = a?.neighbourhood_id ?? null;
      applicationId = a?.id ?? null;
    }
    if (!neighbourhoodId) return null;
    const [{ data: n }, taken] = await Promise.all([
      ctx.supabase.from("neighbourhoods").select("code, capacity").eq("id", neighbourhoodId).maybeSingle(),
      ctx.supabase.rpc("house_numbers_taken", { p_neighbourhood: neighbourhoodId, p_application: applicationId }),
    ]);
    const nb = n as { code: string; capacity: number | null } | null;
    // Some land stores the number with the neighbourhood code in front (KRWJXL0102): count it as 02.
    const plain = (no: string) => {
      const rest = nb?.code && no.toUpperCase().startsWith(nb.code.toUpperCase()) ? no.slice(nb.code.length) : no;
      return /^\d+$/.test(rest) ? rest.padStart(2, "0") : rest;
    };
    const ownPlain = own ? plain(own) : null;
    let skippedOwn = false;
    return {
      capacity: Math.max(1, Number(nb?.capacity ?? 50) || 50),
      taken: ((unwrap(taken, "house numbers") as { house_no: string; apartment: boolean }[]) ?? [])
        .map((x) => ({ ...x, house_no: plain(x.house_no) }))
        // The parcel's own number once (another house with the same number still counts).
        .filter((x) => (ownPlain && x.house_no === ownPlain && !skippedOwn ? !(skippedOwn = true) : true)),
    };
  },
);

/** Register partial land straight from the parcel: PUN, bills, owners. */
export const registerParcelAction = defineAction(
  "parcels.register",
  z.object({ parcelId: z.uuid() }),
  async ({ parcelId }, ctx) => {
    const out = unwrap(
      await ctx.supabase.rpc("parcel_register", { p_parcel: parcelId }),
      "register parcel",
    ) as { pun: string; parcel_id: string };
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    revalidatePath("/[locale]/cashier", "page");
    return out;
  },
);

/** Delete land (kept in the history with its reason): partial land, or registered land for admins. */
export const deleteParcelAction = defineAction(
  "parcels.delete",
  z.object({ id: z.uuid(), reason }),
  async ({ id, reason: why }, ctx) => {
    unwrap(await ctx.supabase.rpc("parcel_delete", { p_id: id, p_reason: why }), "delete parcel");
    refresh();
    return null;
  },
);

/** Check if it exists: send a district surveyor to confirm the house is there. */
export const requestParcelCheckAction = defineAction(
  "parcels.site_check",
  z.object({ id: z.uuid(), note: z.string().trim().max(500).default("") }),
  async ({ id, note }, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_request_site_check", { p_id: id, p_note: note || null }),
      "request site check",
    );
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

/** The surveyor's answer: the house exists, or it wasn't found (with a note). */
export const confirmParcelSiteAction = defineAction(
  "parcels.site_confirm",
  z.object({ id: z.uuid(), exists: z.boolean(), note: z.string().trim().max(500).default("") }),
  async ({ id, exists, note }, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_confirm_site", {
        p_id: id,
        p_exists: exists,
        p_note: note || null,
      }),
      "confirm site",
    );
    refresh();
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);
