"use server";

import { createRoleSchema, deleteRoleSchema, updateRoleSchema } from "@dhulka/core/schemas";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, unwrap, withIdempotency } from "@/lib/server/action";

const limitsJson = (l: { maxWaiverAmount: number | null; maxRefundAmount: number | null }) =>
  Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null));

export const createRoleAction = defineAction("admin.roles.create", createRoleSchema, async (input, ctx) =>
  withIdempotency(ctx, input.idempotencyKey, "roles.create", async () => {
    const id = unwrap(
      await ctx.supabase.rpc("admin_create_role", {
        p_name_so: input.nameSo,
        p_name_en: input.nameEn,
        p_description: input.description,
        p_colour: input.colour,
        p_data_scope: input.dataScope,
        p_limits: limitsJson(input.limits),
        p_permissions: input.permissions,
      }),
      "create role",
    ) as string;
    revalidatePath("/[locale]/admin/roles", "page");
    return { roleId: id };
  }),
);

export const updateRoleAction = defineAction("admin.roles.update", updateRoleSchema, async (input, ctx) => {
  unwrap(
    await ctx.supabase.rpc("admin_update_role", {
      p_role_id: input.roleId,
      p_name_so: input.nameSo,
      p_name_en: input.nameEn,
      p_description: input.description,
      p_colour: input.colour,
      p_data_scope: input.dataScope,
      p_limits: limitsJson(input.limits),
      p_permissions: input.permissions,
    }),
    "update role",
  );
  revalidatePath("/[locale]/admin/roles", "layout");
  return null;
});

export const resetRoleAction = defineAction("admin.roles.reset", deleteRoleSchema, async ({ roleId }, ctx) => {
  unwrap(await ctx.supabase.rpc("admin_reset_role_to_default", { p_role_id: roleId }), "reset role");
  revalidatePath("/[locale]/admin/roles", "layout");
  return null;
});

/** Delete a role; optionally move its users to another role first (same request). */
export const deleteRoleAction = defineAction(
  "admin.roles.delete",
  deleteRoleSchema.extend({ moveToRoleId: z.uuid().nullable().default(null) }),
  async ({ roleId, moveToRoleId }, ctx) => {
    let moved = 0;
    if (moveToRoleId) {
      moved = unwrap(await ctx.supabase.rpc("admin_move_role_users", { p_from: roleId, p_to: moveToRoleId }), "move users") as number;
    }
    unwrap(await ctx.supabase.rpc("admin_delete_role", { p_role_id: roleId }), "delete role");
    revalidatePath("/[locale]/admin/roles", "page");
    return { moved };
  },
);
