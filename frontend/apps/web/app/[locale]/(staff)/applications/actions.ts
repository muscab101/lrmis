"use server";

import {
  applicationPartiesSchema,
  applicationTransitionSchema,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  partySchema,
  saveApplicationLocationSchema,
} from "@dhulka/core/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, fail, unwrap, withIdempotency } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "application-documents";

type LocationOut = z.output<typeof saveApplicationLocationSchema>;

function locationPayload(v: LocationOut) {
  return {
    type: v.type,
    channel: v.channel,
    district_id: v.districtId,
    neighbourhood_id: v.neighbourhoodId,
    pin_lon: v.pinLon,
    pin_lat: v.pinLat,
    pin_accuracy_m: v.pinAccuracyM,
    address_note: v.addressNote,
    plot_no: v.plotNo,
    old_deed_no: v.oldDeedNo,
    govt_file_no: v.govtFileNo,
  };
}

/** How the pin was captured (GPS or moved by hand) and the declared plot size. */
async function saveLocationMeta(ctx: { supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>> }, id: string, v: LocationOut) {
  unwrap(
    await ctx.supabase.rpc("application_location_meta", { p_id: id, p_method: v.pinLon == null ? null : v.pinMethod, p_width: v.plotWidthM, p_length: v.plotLengthM }),
    "location meta",
  );
  unwrap(
    await ctx.supabase.rpc("application_set_details", {
      p_id: id,
      p_house_no: v.houseNo,
      p_govt_receipt_no: v.govtReceiptNo,
      p_property_type: v.propertyType || null,
      p_land_use: v.landUse || null,
    }),
    "details",
  );
}

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

/** Map location RPC errors (e.g. "VALIDATION: pin_outside_neighbourhood") onto form fields. */
function locationFieldError(err: unknown): never {
  if (err instanceof AppFailure && err.code === "VALIDATION") {
    const detail = String(err.values?.detail ?? "");
    const field = detail.startsWith("pin") ? "pin" : detail.startsWith("neighbourhood") ? "neighbourhoodId" : "districtId";
    throw new AppFailure("VALIDATION", err.values, { [field]: [`validation.${detail}`] });
  }
  throw err;
}

export const createApplicationAction = defineAction(
  "applications.create",
  saveApplicationLocationSchema.extend({ idempotencyKey: z.uuid() }),
  async ({ idempotencyKey, ...input }, ctx) =>
    withIdempotency(ctx, idempotencyKey, "applications.create", async () => {
      try {
        const out = unwrap(await ctx.supabase.rpc("application_create", { p: locationPayload(input) }), "create application") as {
          id: string;
          number: string;
        };
        await saveLocationMeta(ctx, out.id, input);
        return out;
      } catch (err) {
        locationFieldError(err);
      }
    }),
);

export const updateApplicationAction = defineAction(
  "applications.update",
  saveApplicationLocationSchema.extend({ applicationId: z.uuid() }),
  async ({ applicationId, ...input }, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("application_update", { p_id: applicationId, p: locationPayload(input) }), "update application");
      await saveLocationMeta(ctx, applicationId, input);
    } catch (err) {
      locationFieldError(err);
    }
    revalidatePath("/[locale]/applications/[id]", "page");
    return null;
  },
);

export const setApplicationPartiesAction = defineAction("applications.parties", applicationPartiesSchema, async ({ applicationId, parties }, ctx) => {
  unwrap(
    await ctx.supabase.rpc("application_set_parties", {
      p_id: applicationId,
      p_parties: parties.map((p) => ({ party_id: p.partyId, role: p.role, share_pct: p.sharePct })),
    }),
    "set parties",
  );
  return null;
});

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-80) || "file";
}

/** Upload to the private bucket (server only), then register it; the upload is removed if registering fails. */
export async function uploadDocumentAction(form: FormData) {
  const handler = defineAction(
    "applications.upload",
    z.object({ applicationId: z.uuid(), docType: z.string().regex(/^[a-z_]+$/) }),
    async ({ applicationId, docType }, ctx) => {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
      if (file.size > DOCUMENT_MAX_BYTES) throw new AppFailure("VALIDATION", undefined, { file: ["validation.file_too_big"] });
      if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.file_type"] });
      }
      const path = `${applicationId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const admin = await createAdminClient();
      const up = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error(`storage upload: ${up.error.message}`);
      const reg = await ctx.supabase.rpc("application_add_document", {
        p_id: applicationId,
        p_doc_type: docType,
        p_storage_path: path,
        p_file_name: file.name,
        p_mime: file.type,
        p_size: file.size,
      });
      if (reg.error) {
        const rm = await admin.storage.from(BUCKET).remove([path]);
        if (rm.error) log("error", "applications.upload_cleanup_failed", { requestId: ctx.requestId, path });
        unwrap(reg, "register document");
      }
      revalidatePath("/[locale]/applications/[id]", "page");
      return null;
    },
  );
  return handler({ applicationId: String(form.get("applicationId") ?? ""), docType: String(form.get("docType") ?? "") });
}

export const removeDocumentAction = defineAction("applications.remove_document", z.object({ docId: z.uuid() }), async ({ docId }, ctx) => {
  unwrap(await ctx.supabase.rpc("application_remove_document", { p_doc_id: docId }), "remove document");
  revalidatePath("/[locale]/applications/[id]", "page");
  return null;
});

/** Short-lived signed link, issued only if the caller may see the application. */
export const documentUrlAction = defineAction("applications.document_url", z.object({ docId: z.uuid() }), async ({ docId }, ctx) => {
  const path = unwrap(await ctx.supabase.rpc("application_document_path", { p_doc_id: docId }), "document path") as string | null;
  if (!path) fail("NOT_FOUND");
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data) throw new Error(`signed url: ${error?.message}`);
  return { url: data.signedUrl };
});

export const submitApplicationAction = defineAction("applications.submit", z.object({ applicationId: z.uuid() }), async ({ applicationId }, ctx) => {
  const out = unwrap(await ctx.supabase.rpc("application_submit", { p_id: applicationId }), "submit") as { number: string };
  revalidatePath("/[locale]/applications", "layout");
  return out;
});

export const transitionApplicationAction = defineAction("applications.transition", applicationTransitionSchema, async ({ applicationId, action, note }, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("application_transition", { p_id: applicationId, p_action: action, p_note: note }), "transition");
  } catch (err) {
    if (err instanceof AppFailure && err.code === "VALIDATION" && err.values?.detail === "note_required") {
      throw new AppFailure("VALIDATION", undefined, { note: ["validation.note_required"] });
    }
    throw err;
  }
  revalidatePath("/[locale]/applications", "layout");
  return null;
});

// ---------------------------------------------------------------------------
// Owners (parties)
// ---------------------------------------------------------------------------
function partyPayload(v: z.output<typeof partySchema>) {
  return {
    kind: v.kind,
    full_name: v.fullName,
    mother_name: v.motherName,
    gender: v.gender,
    date_of_birth: v.dateOfBirth,
    nationality: v.nationality,
    id_type: v.idType,
    id_number: v.idNumber,
    phone: v.phone,
    email: v.email,
    address: v.address,
    org_registration_no: v.orgRegistrationNo,
    next_of_kin: v.nextOfKinName || v.nextOfKinPhone ? { name: v.nextOfKinName, phone: v.nextOfKinPhone } : {},
    district_id: v.districtId,
  };
}

function partyErrors(err: unknown): never {
  if (err instanceof AppFailure && err.code === "CONFLICT" && err.values?.detail === "id_number") {
    throw new AppFailure("CONFLICT", undefined, { idNumber: ["validation.id_taken"] });
  }
  throw err;
}

export const savePartyAction = defineAction("owners.save", z.object({ id: z.uuid().nullable(), input: partySchema }), async ({ id, input }, ctx) => {
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
  }
  throw err;
}

/** Move a draft owner (partial registration) to the register. */
export const registerOwnerAction = defineAction("owners.register", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("party_register", { p_id: id }), "register owner");
  } catch (err) {
    ownerErrors(err);
  }
  revalidatePath("/[locale]/owners", "layout");
  return null;
});

/** Delete a draft owner. */
export const deleteOwnerAction = defineAction("owners.delete", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("party_delete", { p_id: id }), "delete owner");
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

export const duplicatePartiesAction = defineAction(
  "owners.duplicates",
  z.object({
    fullName: z.string().max(160),
    motherName: z.string().max(120).default(""),
    idType: z.string().max(40).default(""),
    idNumber: z.string().max(40).default(""),
    phone: z.string().max(20).default(""),
    excludeId: z.uuid().nullable().default(null),
  }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("find_duplicate_parties", {
        p_full_name: v.fullName,
        p_mother_name: v.motherName,
        p_id_type: v.idType,
        p_id_number: v.idNumber,
        p_phone: v.phone.replace(/[\s()-]/g, ""),
        p_exclude: v.excludeId,
      }),
      "duplicates",
    ) as { count: number; matches?: { id: string; full_name: string; mother_name: string | null; phone: string | null; reasons: string[] }[]; reasons?: string[] },
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

const REGISTER_BLOCKERS = ["site_not_confirmed", "not_submitted", "fee_due", "open_objection", "no_location"];

/** Move to Parcels right after the ✓ site check (Registrar): PUN, account number and owners. */
export const registerConfirmedAction = defineAction(
  "applications.register_confirmed",
  z.object({
    applicationId: z.uuid(),
    landUse: z.enum(["residential", "commercial", "mixed", "state", "agricultural", "other"]),
    note: z.string().trim().max(1000, "validation.too_long").default(""),
  }),
  async ({ applicationId, landUse, note }, ctx) => {
    let out: { pun: string; parcel_id: string };
    try {
      out = unwrap(
        await ctx.supabase.rpc("application_register_confirmed", { p_id: applicationId, p_land_use: landUse, p_note: note || null }),
        "register",
      ) as { pun: string; parcel_id: string };
    } catch (err) {
      const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
      if (err instanceof AppFailure && err.code === "CONFLICT" && REGISTER_BLOCKERS.includes(detail)) {
        throw new AppFailure("CONFLICT", undefined, { register: [`validation.register_${detail}`] });
      }
      throw err;
    }
    revalidatePath("/[locale]/applications", "layout");
    revalidatePath("/[locale]/parcels", "layout");
    return out;
  },
);
