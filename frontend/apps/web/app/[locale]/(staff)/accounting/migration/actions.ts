"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prepare, type AccountMap, type ColumnMap, type TableTarget } from "@/lib/migration/prepare";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { getMigration, mappingTargets, migrationRows, type RunResult } from "@/lib/server/acct-migration";

const id = z.uuid();
const done = <T>(v: T) => {
  revalidatePath("/[locale]/accounting/migration", "layout");
  revalidatePath("/[locale]/accounting", "page");
  return v;
};

const fieldMap = z.object({
  col: z.string().max(200).nullable(),
  transform: z.enum(["none", "trim", "upper", "lower", "number", "date"]).optional(),
  format: z.enum(["auto", "ymd", "dmy", "mdy", "unix"]).optional(),
  default: z.string().max(200).optional(),
  factor: z.number().positive().max(1_000_000).optional(),
});
const entity = z.enum(["accounts", "entries", "lines"]);

/** Stages 5–7 and 10: save the table, column and ID mapping, and the options. Changing them means testing again. */
export const saveMigrationAction = defineAction(
  "accounting.migration_save",
  z.object({
    id,
    tableMap: z.record(z.string().max(200), z.enum(["accounts", "entries", "lines", "ignore"])).optional(),
    columnMap: z.partialRecord(entity, z.record(z.string().max(40), fieldMap)).optional(),
    accountMap: z
      .record(
        z.string().max(200),
        z.object({
          code: z.string().regex(/^\d{4}$/, "validation.account_code"),
          create: z.boolean(),
          name_en: z.string().max(200).optional(),
          name_so: z.string().max(200).optional(),
          type: z.enum(["asset", "liability", "equity", "income", "expense"]).optional(),
        }),
      )
      .optional(),
    districtMap: z.record(z.string().max(200), z.union([z.uuid(), z.literal("")])).optional(),
    options: z.object({ lock_months: z.boolean() }).optional(),
  }),
  async (v, ctx) => {
    const p: Record<string, unknown> = {};
    if (v.tableMap) p.table_map = v.tableMap;
    if (v.columnMap) p.column_map = v.columnMap;
    if (v.accountMap) p.account_map = v.accountMap;
    if (v.districtMap) p.district_map = v.districtMap;
    if (v.options) p.options = v.options;
    unwrap(await ctx.supabase.rpc("acct_migration_save", { p_id: v.id, p }), "save migration");
    return done(null);
  },
);

/** Stage 8: work out every record from the old rows and the mapping (the preview the test and the run use). */
export const prepareMigrationAction = defineAction("accounting.migration_prepare", z.object({ id }), async (v, ctx) => {
  const m = await getMigration(v.id);
  if (!m) throw new AppFailure("NOT_FOUND");
  const tableMap = m.table_map as Record<string, TableTarget>;
  const used = Object.entries(tableMap)
    .filter(([, t]) => t !== "ignore")
    .map(([name]) => name);
  if (!used.length) throw new AppFailure("CONFLICT", { detail: "migration_no_tables" });
  const [tables, targets] = await Promise.all([migrationRows(v.id, used), mappingTargets()]);
  const out = prepare({
    tables,
    tableMap,
    columnMap: m.column_map as ColumnMap,
    accountMap: m.account_map as AccountMap,
    ourAccounts: targets.accounts.map((a) => a.code),
  });
  const chunks = Math.max(1, Math.ceil(out.items.length / 2000));
  for (let i = 0; i < chunks; i++) {
    unwrap(
      await ctx.supabase.rpc("acct_migration_set_items", {
        p_id: v.id,
        p_items: out.items.slice(i * 2000, (i + 1) * 2000),
        p_reset: i === 0,
        p_summary: i === chunks - 1 ? { ...out.summary, warnings: out.warnings } : null,
      }),
      "migration items",
    );
  }
  return done(out.summary);
});

/** Stage 2: copy the books before the run. */
export const backupMigrationAction = defineAction("accounting.migration_backup", z.object({ id }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("acct_migration_backup", { p_id: v.id }), "migration backup") as { ok: boolean; counts: Record<string, number> }),
);

/** Stage 9: the whole migration, put back afterwards. */
export const testMigrationAction = defineAction("accounting.migration_test", z.object({ id }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("acct_migration_test", { p_id: v.id }), "migration test") as RunResult),
);

/** Stage 11: the real run. */
export const runMigrationAction = defineAction("accounting.migration_run", z.object({ id }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("acct_migration_run", { p_id: v.id }), "migration run") as RunResult),
);

/** Take a run back out of the books. */
export const undoMigrationAction = defineAction(
  "accounting.migration_undo",
  z.object({ id, reason: z.string().trim().min(5, "validation.reason").max(500) }),
  async (v, ctx) => done(unwrap(await ctx.supabase.rpc("acct_migration_undo", { p_id: v.id, p_reason: v.reason }), "migration undo") as { entries: number }),
);
