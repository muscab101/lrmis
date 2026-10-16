"use client";

import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { searchNeighbourhoodsAction } from "@/app/[locale]/(staff)/locations/actions";

export function NeighbourhoodPicker({ value, onChange, disabled }: { value: ComboOption | null; onChange: (o: ComboOption | null) => void; disabled?: boolean }) {
  const t = useTranslations("valuation");
  const tc = useTranslations("common");
  const locale = useLocale();
  const search = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchNeighbourhoodsAction({ q, districtId: null });
      if (!res.ok) return [];
      return res.data.map((n) => ({ value: n.id, label: locale === "so" ? n.name_so : n.name_en, hint: `${n.district_code}-${n.code}` }));
    },
    [locale],
  );
  return (
    <AsyncCombobox
      search={search}
      value={value ? [value] : []}
      onChange={(o) => onChange(o[0] ?? null)}
      disabled={disabled}
      placeholder={t("chooseNeighbourhood")}
      searchPlaceholder={tc("search")}
      emptyText={tc("noResults")}
    />
  );
}
