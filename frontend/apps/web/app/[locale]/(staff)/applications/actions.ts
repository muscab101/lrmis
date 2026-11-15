"use server";

import { ownerSchema, partySchema } from "@dhulka/core/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { partyErrors, partyPayload } from "@/lib/server/party-payload";

/** Parcels or open applications within a few metres of a point (possible double registration). */
export const nearbyPinsAction = defineAction(
  "applications.nearby",
  z.object({ lon: z.number().min(40).max(52), lat: z.number().min(-2).max(12.5), excludeId: z.uuid().nullable().default(null) }),
  async (v, ctx) =>
    unwrap(await ctx.supabase.rpc("pin_nearby", { p_lon: v.lon, p_lat: v.lat, p_exclude: v.excludeId }), "nearby") as {
      count: number;
      parcels?: { pun: string; metres: number }[];
      applications?: { number: string; metres: number }[];
    },
);

// ---------------------------------------------------------------------------
// Owners (parties)
// ---------------------------------------------------------------------------
export const savePartyAction = defineAction("owners.save", z.object({ id: z.uuid().nullable(), input: ownerSchema }), async ({ id, input }, ctx) => {
  try {
    const partyId = unwrap(await ctx.supabase.rpc("save_party", { p_id: id, p: partyPayload(input) }), "save party") as string;
    revalidatePath("/[locale]/owners", "layout");
    return { id: partyId };
  } catch (err) {
    partyErrors(err);
  }
});

/** Owner errors shown under the confirm dialog. */
function ownerErrors(err: unknown): never {
  if (err instanceof AppFailure) {
    const detail = err.values?.detail;
    if (err.code === "VALIDATION" && detail === "identity_required") throw new AppFailure("VALIDATION", undefined, { owner: ["validation.owner_identity_required"] });
    if (err.code === "CONFLICT" && detail === "registered") throw new AppFailure("CONFLICT", undefined, { owner: ["validation.owner_registered"] });
    if (err.code === "HAS_RECORDS") throw new AppFailure("HAS_RECORDS", undefined, { owner: ["validation.owner_in_use"] });
    if (err.code === "VALIDATION" && detail === "reason") throw new AppFailure("VALIDATION", undefined, { reason: ["validation.reason"] });
  }
  throw err;
}

/** Delete a draft owner. */
export const deleteOwnerAction = defineAction("owners.delete", z.object({ id: z.uuid(), reason: z.string().trim().max(500).default("") }), async ({ id, reason }, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("party_delete", { p_id: id, p_reason: reason || null }), "delete owner");
  } catch (err) {
    ownerErrors(err);
  }
  revalidatePath("/[locale]/owners", "layout");
  return null;
});

export const updateMyPartyAction = defineAction("owners.save_mine", partySchema, async (input, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("update_my_party", { p: partyPayload(input) }), "update my party");
  } catch (err) {
    partyErrors(err);
  }
  revalidatePath("/[locale]/portal", "layout");
  return null;
});

export const searchPartiesAction = defineAction("owners.search", z.object({ q: z.string().max(80) }), async ({ q }, ctx) =>
  unwrap(await ctx.supabase.rpc("search_parties", { p_q: q, p_limit: 20 }), "search parties") as {
    id: string;
    kind: string;
    full_name: string;
    mother_name: string | null;
    id_type: string | null;
    id_number: string | null;
    phone: string | null;
  }[],
);

/** "!" — send a surveyor to check the land exists. */
export const requestSiteCheckAction = defineAction(
  "applications.site_check",
  z.object({ applicationId: z.uuid(), note: z.string().trim().max(500, "validation.too_long").default("") }),
  async ({ applicationId, note }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("application_request_site_check", { p_id: applicationId, p_note: note || null }), "site check");
    } catch (err) {
      if (err instanceof AppFailure && err.code === "NOT_FOUND" && err.values?.detail === "surveyor") {
        throw new AppFailure("NOT_FOUND", undefined, { siteCheck: ["validation.no_surveyor_in_district"] });
      }
      throw err;
    }
    revalidatePath("/[locale]/applications", "layout");
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

/** ✓ the land exists, or it wasn't found (note required). */
export const confirmSiteAction = defineAction(
  "applications.site_confirm",
  z.object({ applicationId: z.uuid(), exists: z.boolean(), note: z.string().trim().max(500, "validation.too_long").default("") }),
  async ({ applicationId, exists, note }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("application_confirm_site", { p_id: applicationId, p_exists: exists, p_note: note || null }), "confirm site");
    } catch (err) {
      if (err instanceof AppFailure && err.code === "VALIDATION") throw new AppFailure("VALIDATION", undefined, { note: ["validation.site_note_required"] });
      throw err;
    }
    revalidatePath("/[locale]/applications", "layout");
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

