/** A person's name with every word starting with a capital letter (the rest kept as typed), for printed papers. */
export function capName(name: string | null | undefined): string | null {
  const s = (name ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s
    .split(" ")
    .map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1))
    .join(" ");
}
