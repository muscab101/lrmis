"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { MARK_TYPES, MARKS_BUCKET } from "@/lib/server/certificate-marks";
import { log } from "@/lib/server/log";
import { createAdminClient } from "@/lib/supabase/admin";

const kind = z.enum(["signature", "stamp"]);
const text = z.string().trim().max(120).optional().default("");

async function removeOld(old: string | null, keep: string | null, requestId: string) {
  if (!old || old === keep) return;
  const admin = await createAdminClient();
  const rm = await admin.storage.from(MARKS_BUCKET).remove([old]);
  if (rm.error) log("error", "certificate_marks.cleanup_failed", { requestId, path: old });
}

/** Upload (or change) the signature or the stamp. The signature also keeps the signer's name and title. */
export async function uploadMarkAction(form: FormData) {
  const handler = defineAction(
    "certificates.marks_upload",
    z.object({ kind, name: text, title: text }),
    async (v, ctx) => {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0)
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.required"] });
      if (file.size > 2 * 1024 * 1024)
        throw new AppFailure("VALIDATION", undefined, {
          file: ["validation.profile_photo_too_big"],
        });
      if (!MARK_TYPES.includes(file.type))
        throw new AppFailure("VALIDATION", undefined, { file: ["validation.portrait_type"] });
      const path = `${v.kind}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
      const admin = await createAdminClient();
      const up = await admin.storage
        .from(MARKS_BUCKET)
        .upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(`certificate mark upload: ${up.error.message}`);
      let old: string | null;
      try {
        old = unwrap(
          await ctx.supabase.rpc("certificate_marks_set", {
            p_kind: v.kind,
            p_path: path,
            p_name: v.kind === "signature" ? v.name : null,
            p_title: v.kind === "signature" ? v.title : null,
          }),
          "set certificate mark",
        ) as string | null;
      } catch (err) {
        await admin.storage.from(MARKS_BUCKET).remove([path]);
        throw err;
      }
      await removeOld(old, path, ctx.requestId);
      revalidatePath("/[locale]", "layout");
      return null;
    },
  );
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  // Zod checks the kind; an unknown one fails validation.
  return handler({
    kind: str("kind") as "signature" | "stamp",
    name: str("name"),
    title: str("title"),
  });
}

/** Take the signature or the stamp off certificates. */
export const removeMarkAction = defineAction(
  "certificates.marks_remove",
  z.object({ kind }),
  async (v, ctx) => {
    // Taking the signature image off keeps the signer's name and title.
    const { data: row } = await ctx.supabase
      .from("certificate_marks")
      .select("signer_name, signer_title")
      .eq("kind", v.kind)
      .maybeSingle();
    const current = row as { signer_name: string | null; signer_title: string | null } | null;
    const old = unwrap(
      await ctx.supabase.rpc("certificate_marks_set", {
        p_kind: v.kind,
        p_path: null,
        p_name: current?.signer_name ?? null,
        p_title: current?.signer_title ?? null,
      }),
      "remove certificate mark",
    ) as string | null;
    await removeOld(old, null, ctx.requestId);
    revalidatePath("/[locale]", "layout");
    return null;
  },
);

/** Change the signer's name and title shown under the signature. */
export const saveSignerAction = defineAction(
  "certificates.signer",
  z.object({ name: text, title: text }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("certificate_signer_set", { p_name: v.name, p_title: v.title }),
      "set signer",
    );
    revalidatePath("/[locale]", "layout");
    return null;
  },
);
