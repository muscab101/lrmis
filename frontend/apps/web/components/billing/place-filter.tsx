"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export type PlaceOption = { id: string; label: string };
export type PlaceLevel = "d" | "s" | "k" | "n";

/**
 * Pick a district, then a section, a sector and a neighbourhood, to see only that place. The choice lives in the
 * URL (?d=&s=&k=&n=); changing one level clears the levels below it.
 */
export function PlaceFilter({
  levels,
  query,
}: {
  levels: { key: PlaceLevel; options: PlaceOption[] }[];
  query: Partial<Record<PlaceLevel, string>>;
}) {
  const t = useTranslations("billing.placeFilter");
  const router = useRouter();
  const pathname = usePathname();
  const order: PlaceLevel[] = ["d", "s", "k", "n"];
  const pick = (key: PlaceLevel, value: string) => {
    const q = new URLSearchParams();
    for (const k of order.slice(0, order.indexOf(key))) if (query[k]) q.set(k, query[k]!);
    if (value) q.set(key, value);
    router.push(q.size ? `${pathname}?${q.toString()}` : pathname);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      {levels.map((l) => (
        <label key={l.key} className="text-muted-foreground grid gap-1 text-xs">
          {t(l.key)}
          <NativeSelect
            className="h-9 min-w-40"
            value={query[l.key] ?? ""}
            onChange={(e) => pick(l.key, e.target.value)}
          >
            <option value="">{t("all")}</option>
            {l.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      ))}
    </div>
  );
}
