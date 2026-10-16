import "server-only";

// A small per-user hourly budget so one person can't run up the bill (per server instance).
const recent = new Map<string, number[]>();

export function withinBudget(user: string, perHour: number) {
  const now = Date.now();
  const list = (recent.get(user) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= perHour) return false;
  list.push(now);
  recent.set(user, list);
  return true;
}
