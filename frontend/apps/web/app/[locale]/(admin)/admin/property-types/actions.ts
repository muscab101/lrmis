"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const typeSchema = z.object({
  id: z.uuid().nullable(),
  nameSo: z.string().trim().min(2, "validation.required").max(80, "validation.too_long"),
  nameEn: z.string().trim().min(2, "validation.required").max(80, "validation.too_long"),
  price: z.coerce.number().min(0, "validation.amount").max(100_000_000, "validation.amount"),
  currency: z.enum(["USD", "SOS"]).default("USD"),
  active: z.boolean().default(true),
});

function refresh() {
  revalidatePath("/[locale]/admin/property-types", "page");
  revalidatePath("/[locale]/applications", "layout");
}

/** Add or change a type of house / land (settings.update). */
export const savePropertyTypeAction = defineAction("property_types.save", typeSchema, async (v, ctx) => {
  try {
    const id = unwrap(
      await ctx.supabase.rpc("property_type_save", {
        p_id: v.id,
        p: { name_so: v.nameSo, name_en: v.nameEn, price: v.price, currency: v.currency, active: v.active },
      }),
      "save property type",
    ) as string;
    refresh();
    return { id };
  } catch (err) {
    if (err instanceof AppFailure && err.code === "VALIDATION") {
      const detail = String(err.values?.detail ?? "");
      if (detail === "fx_rate_missing") throw new AppFailure("VALIDATION", undefined, { price: ["validation.fx_rate_missing"] });
      const field = detail === "name_so" ? "nameSo" : detail === "name_en" ? "nameEn" : detail === "price" ? "price" : null;
      if (field) throw new AppFailure("VALIDATION", undefined, { [field]: ["validation.required"] });
    }
    throw err;
  }
});

/** Delete a type nobody uses; one in use is hidden instead. */
export const deletePropertyTypeAction = defineAction("property_types.delete", z.object({ id: z.uuid() }), async ({ id }, ctx) => {
  const result = unwrap(await ctx.supabase.rpc("property_type_delete", { p_id: id }), "delete property type") as "deleted" | "hidden";
  refresh();
  return { result };
});
