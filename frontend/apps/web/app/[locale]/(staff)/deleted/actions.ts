"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap } from "@/lib/server/action";
import { createAdminClient } from "@/lib/supabase/admin";
import { DELETED_KINDS } from "./kinds";

/** Bring a deleted item back (the database checks deleted.view). A staff user can sign in again. */
export const restoreDeletedAction = defineAction(
  "deleted.restore",
  z.object({ kind: z.enum(DELETED_KINDS), id: z.uuid() }),
  async ({ kind, id }, ctx) => {
    unwrap(await ctx.supabase.rpc("deleted_restore", { p_kind: kind, p_id: id }), "restore");
    if (kind === "user") {
      const admin = await createAdminClient();
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (error) throw new Error(`unban: ${error.message}`);
    }
    revalidatePath("/[locale]/deleted", "page");
    return null;
  },
);
