"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction } from "@/lib/server/action";
import { createAdminClient } from "@/lib/supabase/admin";
import { LEGACY_COLUMNS } from "@/lib/import/csv";

const row = z.object(Object.fromEntries(LEGACY_COLUMNS.map((c) => [c, z.string().max(500).default("")])) as Record<(typeof LEGACY_COLUMNS)[number], z.ZodDefault<z.ZodString>>);
const importSchema = z.object({ rows: z.array(row).min(1).max(1000), commit: z.boolean(), batch: z.string().trim().max(60).default("") });

/**
 * Partial Registration → Excel import. Each row becomes a draft office application with its owner
 * (same rules as `pnpm import-legacy`). Dry run first; nothing is written until `commit`.
 */
export const importLegacyAction = defineAction("applications.import", importSchema, async (v, ctx) => {
  const { data: allowed } = await ctx.supabase.rpc("has_permission", { p_key: "applications.create" });
  if (!allowed) throw new AppFailure("PERMISSION_DENIED");
  const admin = await createAdminClient();
  const batch = v.batch || `web-${new Date().toISOString().slice(0, 10)}`;
  const results: { row: number; ref: string; status: string; number?: string; problems?: string[] }[] = [];
  for (const [i, p] of v.rows.entries()) {
    const { data, error } = await admin.rpc("legacy_import_row", { p, p_actor: ctx.user.id, p_batch: batch, p_dry: !v.commit });
    const r = error ? { status: "error", problems: [error.message] } : (data as { status: string; number?: string; problems?: string[] });
    results.push({ row: i + 2, ref: p.legacy_ref, ...r });
  }
  if (v.commit) revalidatePath("/[locale]/applications", "page");
  return results;
});
