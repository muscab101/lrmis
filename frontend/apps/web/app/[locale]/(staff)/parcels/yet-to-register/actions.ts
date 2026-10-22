"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

function refresh() {
  revalidatePath("/[locale]/parcels", "layout");
  revalidatePath("/[locale]/surveys", "layout");
}

/** Surveyors who work in a district, least busy first. */
export const districtSurveyorsAction = defineAction("surveys.zone_candidates", z.object({ districtId: z.uuid() }), async ({ districtId }, ctx) =>
  (unwrap(await ctx.supabase.rpc("district_surveyors", { p_district: districtId }), "surveyors") as { user_id: string; full_name: string; open_zones: number; open_tasks: number }[]).map(
    (s) => ({ ...s, open_zones: Number(s.open_zones), open_tasks: Number(s.open_tasks) }),
  ),
);

export const assignZoneAction = defineAction(
  "surveys.zone_assign",
  z.object({
    neighbourhoodId: z.uuid("validation.neighbourhood"),
    surveyorId: z.uuid("validation.surveyor"),
    note: z.string().trim().max(400, "validation.too_long").default(""),
  }),
  async (v, ctx) => {
    try {
      const id = unwrap(await ctx.supabase.rpc("survey_zone_assign", { p_neighbourhood: v.neighbourhoodId, p_surveyor: v.surveyorId, p_target: null, p_note: v.note }), "assign zone") as string;
      refresh();
      return { id };
    } catch (err) {
      if (err instanceof AppFailure && err.code === "VALIDATION") {
        const detail = String(err.values?.detail ?? "");
        throw new AppFailure("VALIDATION", err.values, { [detail === "surveyor" ? "surveyorId" : "target"]: [`validation.${detail}`] });
      }
      throw err;
    }
  },
);

export const closeZoneAction = defineAction("surveys.zone_close", z.object({ id: z.uuid(), status: z.enum(["done", "cancelled"]) }), async (v, ctx) => {
  unwrap(await ctx.supabase.rpc("survey_zone_close", { p_id: v.id, p_status: v.status }), "close zone");
  refresh();
  return null;
});
