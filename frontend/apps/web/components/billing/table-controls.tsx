"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { PAGE_SIZES } from "./page-sizes";
import { NativeSelect } from "@dhulka/ui/form-controls";

/** "Show [10] entries": changing it goes back to page 1 with the new size. */
export function EntriesSelect({ size, query }: { size: number; query: Record<string, string> }) {
  const t = useTranslations("billing");
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm">
      {t("table.show")}
      <NativeSelect
        className="h-8 w-auto"
        value={size}
        onChange={(e) => {
          const q = new URLSearchParams({ ...query, size: e.target.value });
          q.delete("page");
          router.push(`${pathname}?${q.toString()}`);
        }}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </NativeSelect>
      {t("table.entries")}
    </label>
  );
}
