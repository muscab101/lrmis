"use server";

import { revalidatePath } from "next/cache";
import { propertyTypeCode } from "@dhulka/core/schemas";
import { z } from "zod";
import { AppFailure, defineAction, fail, unwrap } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { createAdminClient } from "@/lib/supabase/admin";

const PHOTO_BUCKET = "survey-photos";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const position = z.tuple([z.number().min(40).max(52), z.number().min(-2).max(12.5)]);
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(position).min(4).max(500)).length(1),
});

const surveySaveSchema = z.object({
  surveyId: z.uuid(),
  geojson: polygonSchema.nullable().optional(),
  method: z.enum(["drawn", "gps_walk", "imported"]).optional(),
  accuracyM: z.number().min(0).max(1000).nullable().optional(),
  neighbours: z.object({ north: z.string().max(120), east: z.string().max(120), south: z.string().max(120), west: z.string().max(120) }).partial().optional(),
  building: z
    .object({
      type: z.string().max(40),
      floors: z.number().int().min(0).max(60).nullable(),
      use: z.string().max(40),
      condition: z.string().max(40),
    })
    .partial()
    .optional(),
  notes: z.string().max(2000).optional(),
});

/** Map survey RPC errors onto a "geometry" field so the workspace can show them inline. */
function geometryError(err: unknown): never {
  if (err instanceof AppFailure && err.code === "VALIDATION" && err.values?.detail) {
    throw new AppFailure("VALIDATION", err.values, { geometry: [`validation.survey_${String(err.values.detail).replace(/\s+/g, "_")}`] });
  }
  throw err;
}

export const saveSurveyAction = defineAction("surveys.save", surveySaveSchema, async (v, ctx) => {
  const p: Record<string, unknown> = {};
  if (v.geojson !== undefined) p.geojson = v.geojson;
  if (v.method) p.method = v.method;
  if (v.accuracyM !== undefined) p.accuracy_m = v.accuracyM;
  if (v.neighbours) p.neighbours = v.neighbours;
  if (v.building) p.building = v.building;
  if (v.notes !== undefined) p.notes = v.notes;
  try {
    return unwrap(await ctx.supabase.rpc("survey_save", { p_id: v.surveyId, p }), "save survey") as { area_m2: number | null; perimeter_m: number | null };
  } catch (err) {
    geometryError(err);
  }
});

export const submitSurveyAction = defineAction("surveys.submit", z.object({ surveyId: z.uuid() }), async ({ surveyId }, ctx) => {
  try {
    const out = unwrap(await ctx.supabase.rpc("survey_submit", { p_id: surveyId }), "submit survey") as {
      status: string;
      overlaps: { pun: string | null; overlap_m2: number }[];
    };
    revalidatePath("/[locale]/surveys", "layout");
    return out;
  } catch (err) {
    geometryError(err);
  }
});

export const gisReviewAction = defineAction(
  "surveys.gis_review",
  z.object({ surveyId: z.uuid(), action: z.enum(["accept", "return"]), note: z.string().max(1000).default(""), geojson: polygonSchema.nullable().default(null) }),
  async ({ surveyId, action, note, geojson }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("survey_gis_review", { p_id: surveyId, p_action: action, p_note: note, p_geojson: geojson }), "gis review");
    } catch (err) {
      if (err instanceof AppFailure && err.values?.detail === "note_required") {
        throw new AppFailure("VALIDATION", undefined, { note: ["validation.note_required"] });
      }
      geometryError(err);
    }
    revalidatePath("/[locale]/surveys", "layout");
    return null;
  },
);

export async function uploadSurveyPhotoAction(form: FormData) {
  const handler = defineAction(
    "surveys.photo",
    z.object({
      surveyId: z.uuid(),
      lon: z.coerce.number().min(40).max(52).nullable(),
      lat: z.coerce.number().min(-2).max(12.5).nullable(),
      caption: z.string().max(200).default(""),
    }),
    async ({ surveyId, lon, lat, caption }, ctx) => {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
      if (file.size > 10 * 1024 * 1024) throw new AppFailure("VALIDATION", undefined, { file: ["validation.file_too_big"] });
      if (!PHOTO_TYPES.includes(file.type)) throw new AppFailure("VALIDATION", undefined, { file: ["validation.photo_type"] });
      const path = `${surveyId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
      const admin = await createAdminClient();
      const up = await admin.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
      const reg = await ctx.supabase.rpc("survey_add_photo", {
        p_id: surveyId,
        p_path: path,
        p_lon: lon,
        p_lat: lat,
        p_taken: new Date().toISOString(),
        p_caption: caption,
      });
      if (reg.error) {
        const rm = await admin.storage.from(PHOTO_BUCKET).remove([path]);
        if (rm.error) log("error", "surveys.photo_cleanup_failed", { requestId: ctx.requestId, path });
        unwrap(reg, "register photo");
      }
      revalidatePath("/[locale]/surveys/[id]", "page");
      return null;
    },
  );
  const num = (k: string) => {
    const v = form.get(k);
    return v === null || v === "" ? null : Number(v);
  };
  return handler({ surveyId: String(form.get("surveyId") ?? ""), lon: num("lon"), lat: num("lat"), caption: String(form.get("caption") ?? "") });
}

export const photoUrlAction = defineAction("surveys.photo_url", z.object({ photoId: z.uuid() }), async ({ photoId }, ctx) => {
  const path = unwrap(await ctx.supabase.rpc("survey_photo_path", { p_photo: photoId }), "photo path") as string | null;
  if (!path) fail("NOT_FOUND");
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new Error(`signed url: ${error?.message}`);
  return { url: data.signedUrl };
});

const objectionSchema = z.object({
  noticeId: z.uuid(),
  name: z.string().trim().min(2, "validation.name").max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .pipe(z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{7,14}$/, "validation.phone")])),
  statement: z.string().trim().min(10, "validation.statement").max(2000, "validation.too_long"),
});

export const fileObjectionAction = defineAction(
  "notices.object",
  objectionSchema,
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("objection_file", { p_notice_id: v.noticeId, p_name: v.name, p_phone: v.phone, p_statement: v.statement }), "objection");
    revalidatePath("/[locale]/applications", "layout");
    return null;
  },
);

export const registerParcelAction = defineAction(
  "applications.register",
  z.object({ applicationId: z.uuid(), landUse: z.enum(["residential", "commercial", "state", "mixed", "agricultural", "other"]), note: z.string().max(1000).default("") }),
  async ({ applicationId, landUse, note }, ctx) => {
    const out = unwrap(await ctx.supabase.rpc("application_register", { p_id: applicationId, p_land_use: landUse, p_note: note }), "register") as {
      pun: string;
      account_no: string;
      parcel_id: string;
    };
    revalidatePath("/[locale]", "layout");
    return out;
  },
);

/** Correct the land details found on site while the survey is open (assigned surveyor or supervisor). */
export const updateSurveyDetailsAction = defineAction(
  "surveys.details",
  z.object({
    surveyId: z.uuid(),
    plotNo: z.string().trim().max(40, "validation.too_long").default(""),
    houseNo: z.string().trim().max(40, "validation.too_long").default(""),
    flatNo: z.string().trim().max(20, "validation.too_long").default(""),
    govtReceiptNo: z.string().trim().max(60, "validation.too_long").default(""),
    plotWidthM: z.coerce.number().positive("validation.plot_size").max(10000).nullable(),
    plotLengthM: z.coerce.number().positive("validation.plot_size").max(10000).nullable(),
    addressNote: z.string().trim().max(500, "validation.too_long").default(""),
    propertyType: propertyTypeCode,
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("survey_update_details", {
        p_survey: v.surveyId,
        p: {
          plot_no: v.plotNo,
          house_no: v.houseNo,
          flat_no: v.flatNo,
          govt_receipt_no: v.govtReceiptNo,
          plot_width_m: v.plotWidthM,
          plot_length_m: v.plotLengthM,
          address_note: v.addressNote,
          property_type: v.propertyType,
        },
      }),
      "survey details",
    );
    revalidatePath("/[locale]/surveys/[id]", "page");
    revalidatePath("/[locale]/applications/[id]", "page");
    return null;
  },
);
