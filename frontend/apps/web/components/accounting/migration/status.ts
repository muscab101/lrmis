/** Badge colour for a migration's state. */
export const MIGRATION_TONE = { draft: "draft", tested: "pending", migrated: "approved", undone: "rejected" } as const;

/** The twelve stages, in order (the page's ?stage=1…12). */
export const STAGES = [
  "prepare",
  "backups",
  "inspectOld",
  "inspectNew",
  "tables",
  "columns",
  "ids",
  "preview",
  "test",
  "historical",
  "production",
  "report",
] as const;
export type Stage = (typeof STAGES)[number];
