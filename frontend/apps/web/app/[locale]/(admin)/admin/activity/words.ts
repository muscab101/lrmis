export const ONLINE_MS = 2 * 60_000;

/** A date from the address bar, or null for today. */
export function validDay(day: string | undefined): string | null {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : null;
}

const words = (s: string | null) =>
  (s ?? "")
    .replace(/^public\./, "")
    .replace(/[._]/g, " ")
    .trim();

/** An audit entry in words: "Changed parcels", "billing run issue". */
export function actionWords(
  t: (key: "added" | "changed" | "removed", values: { what: string }) => string,
  action: string | null,
  table: string | null,
) {
  const what = words(table);
  if (action === "insert") return t("added", { what });
  if (action === "update") return t("changed", { what });
  if (action === "delete") return t("removed", { what });
  return words(action);
}
