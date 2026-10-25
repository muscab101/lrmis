"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const posSchema = z.object({
  id: z.uuid().nullable(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, "validation.pos_code"),
  name: z.string().trim().min(2, "validation.required").max(80, "validation.too_long"),
  districtId: z.uuid("validation.required"),
  kind: z.enum(["cashier", "field"]).default("cashier"),
  receiptPrefix: z.string().trim().toUpperCase().regex(/^([A-Z0-9-]{2,16})?$/, "validation.pos_prefix").default(""),
  active: z.boolean().default(true),
});

function refresh() {
  revalidatePath("/[locale]/points-of-sale", "page");
  revalidatePath("/[locale]/cashier", "page");
}

/** Add or change a cash desk (settings.update). */
export const savePosAction = defineAction("pos.save", posSchema, async (v, ctx) => {
  try {
    const id = unwrap(
      await ctx.supabase.rpc("pos_save", {
        p_id: v.id,
        p: { code: v.code, name: v.name, district_id: v.districtId, kind: v.kind, receipt_prefix: v.receiptPrefix, active: v.active },
      }),
      "save point of sale",
    ) as string;
    refresh();
    return { id };
  } catch (err) {
    if (err instanceof AppFailure && err.values?.detail === "pos_code_taken") throw new AppFailure("VALIDATION", undefined, { code: ["validation.pos_code_taken"] });
    throw err;
  }
});

/** Delete a desk nobody used; one with shifts or payments is switched off. */
export const deletePosAction = defineAction("pos.delete", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("pos_delete", { p_id: id }), "delete point of sale") as "deleted" | "hidden";
  refresh();
  return { result };
});
