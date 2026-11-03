"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { PARTY_PHOTO_BUCKET } from "@/lib/server/party-photo";
import { createAdminClient } from "@/lib/supabase/admin";

export interface OwnerTypeOption {
  id: string;
  name_so: string;
  name_en: string;
  active: boolean;
}

/** The choices for the owner form, which opens from several pages. */
export const listOwnerTypesAction = defineAction("owners.types", z.object({}), async (_, ctx) =>
  unwrap(await ctx.supabase.from("owner_types").select("id, name_so, name_en, active").order("sort").order("name_en"), "owner types") as OwnerTypeOption[],
);

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Upload an owner's photo (for the ID card) and replace the old one. */
export async function uploadPartyPhotoAction(form: FormData) {
  const handler = defineAction("owners.photo", z.object({ partyId: z.uuid() }), async ({ partyId }, ctx) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
    if (file.size > 5 * 1024 * 1024) throw new AppFailure("VALIDATION", undefined, { file: ["validation.photo_too_big"] });
    if (!PHOTO_TYPES.includes(file.type)) throw new AppFailure("VALIDATION", undefined, { file: ["validation.portrait_type"] });
    const path = `${partyId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const admin = await createAdminClient();
    const up = await admin.storage.from(PARTY_PHOTO_BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) throw new Error(`photo upload: ${up.error.message}`);
    const res = await ctx.supabase.rpc("party_set_photo", { p_id: partyId, p_path: path });
    if (res.error) {
      const rm = await admin.storage.from(PARTY_PHOTO_BUCKET).remove([path]);
      if (rm.error) log("error", "owners.photo_cleanup_failed", { requestId: ctx.requestId, path });
      unwrap(res, "set photo");
    }
    const old = res.data as string | null;
    if (old) {
      const rm = await admin.storage.from(PARTY_PHOTO_BUCKET).remove([old]);
      if (rm.error) log("error", "owners.photo_cleanup_failed", { requestId: ctx.requestId, path: old });
    }
    revalidatePath("/[locale]/owners/[id]", "page");
    revalidatePath("/[locale]/documents/[id]", "page");
    return null;
  });
  return handler({ partyId: String(form.get("partyId") ?? "") });
}
