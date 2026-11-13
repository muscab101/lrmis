"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap } from "@/lib/server/action";

/** Save how certificates look. Needs the Certificate design power. */
export const saveCertificateDesignAction = defineAction(
  "certificates.design_save",
  z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "validation.colour"),
    titleSo: z.string().trim().max(120),
    titleEn: z.string().trim().max(120),
    note: z.string().trim().max(300),
    watermark: z.boolean(),
    seals: z.boolean(),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("certificate_design_save", {
        p: { accent: v.accent, title_so: v.titleSo, title_en: v.titleEn, note: v.note, watermark: v.watermark, seals: v.seals },
      }),
      "certificate design",
    );
    revalidatePath("/[locale]/admin/certificate-design", "page");
    revalidatePath("/[locale]/documents", "layout");
    return null;
  },
);
