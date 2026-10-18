"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const text = (max: number) => z.string().trim().max(max, "validation.too_long").default("");
const reason = z.string().trim().min(5, "validation.reason").max(500, "validation.too_long");

function refresh() {
  revalidatePath("/[locale]/parcels", "layout");
}

/** Reason errors from the DB go under the reason field. */
function reasonError(err: unknown): never {
  if (err instanceof AppFailure && err.code === "VALIDATION" && err.values?.detail === "reason") {
    throw new AppFailure("VALIDATION", undefined, { reason: ["validation.reason"] });
  }
  throw err;
}

export const updateParcelDetailsAction = defineAction(
  "parcels.details",
  z.object({ id: z.uuid(), houseNo: text(40), govtReceiptNo: text(60), plotNo: text(40) }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("parcel_update_details", {
        p_id: v.id,
        p: { house_no: v.houseNo, govt_receipt_no: v.govtReceiptNo, plot_no: v.plotNo },
      }),
      "parcel details",
    );
    refresh();
    return null;
  },
);

export const lockParcelAction = defineAction("parcels.lock", z.object({ id: z.uuid(), reason }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("parcel_lock", { p_id: v.id, p_reason: v.reason }), "lock parcel");
  } catch (err) {
    reasonError(err);
  }
  refresh();
  return null;
});

export const unlockParcelAction = defineAction("parcels.unlock", z.object({ id: z.uuid(), reason }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("parcel_unlock", { p_id: v.id, p_reason: v.reason }), "unlock parcel");
  } catch (err) {
    reasonError(err);
  }
  refresh();
  return null;
});
