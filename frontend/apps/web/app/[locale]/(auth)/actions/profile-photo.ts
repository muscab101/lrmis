"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { log } from "@/lib/server/log";
import { PROFILE_PHOTO_BUCKET } from "@/lib/server/profile-photo";
import { createAdminClient } from "@/lib/supabase/admin";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Swap the signed-in person's photo and take the old file away. */
async function setPhoto(supabase: Parameters<Parameters<typeof defineAction>[2]>[1]["supabase"], path: string | null, requestId: string) {
  const old = unwrap(await supabase.rpc("profile_set_avatar", { p_path: path }), "set profile photo") as string | null;
  if (old && old !== path) {
    const admin = await createAdminClient();
    const rm = await admin.storage.from(PROFILE_PHOTO_BUCKET).remove([old]);
    if (rm.error) log("error", "profile.photo_cleanup_failed", { requestId, path: old });
  }
  revalidatePath("/[locale]", "layout");
}

/** Anyone signed in: upload their own profile photo (or change it). */
export async function uploadProfilePhotoAction(form: FormData) {
  const handler = defineAction("profile.photo", z.object({}), async (_v, ctx) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
    if (file.size > 2 * 1024 * 1024) throw new AppFailure("VALIDATION", undefined, { file: ["validation.profile_photo_too_big"] });
    if (!PHOTO_TYPES.includes(file.type)) throw new AppFailure("VALIDATION", undefined, { file: ["validation.portrait_type"] });
    const path = `${ctx.user!.id}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const admin = await createAdminClient();
    const up = await admin.storage.from(PROFILE_PHOTO_BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) throw new Error(`profile photo upload: ${up.error.message}`);
    try {
      await setPhoto(ctx.supabase, path, ctx.requestId);
    } catch (err) {
      await admin.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
      throw err;
    }
    return null;
  });
  return handler({});
}

export const removeProfilePhotoAction = defineAction("profile.photo_remove", z.object({}), async (_v, ctx) => {
  await setPhoto(ctx.supabase, null, ctx.requestId);
  return null;
});
