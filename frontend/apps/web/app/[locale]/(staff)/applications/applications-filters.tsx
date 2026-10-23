"use client";

import { OFFICE_APPLICATION_TYPES, type ApplicationsQuery } from "@dhulka/core/schemas";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

export function ApplicationsFilters({
  query,
  districts,
  total,
}: {
  query: ApplicationsQuery;
  districts: { id: string; name_so: string; name_en: string }[];
  total: number;
}) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next}`));
  };

  useEffect(() => {
    if (q === query.q) return;
    const h = setTimeout(() => set({ q }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b p-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className="max-w-xs" aria-label={tc("search")} />
      <div className="w-48">
        <NativeSelect value={query.type} onChange={(e) => set({ type: e.target.value })} aria-label={t("type")}>
          <option value="">{t("anyType")}</option>
          {OFFICE_APPLICATION_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`types.${ty}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="w-48">
        <NativeSelect value={query.district} onChange={(e) => set({ district: e.target.value })} aria-label={t("district")}>
          <option value="">{t("anyDistrict")}</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {locale === "so" ? d.name_so : d.name_en}
            </option>
          ))}
        </NativeSelect>
      </div>
      <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
        {pending ? tc("loading") : t("count", { count: total })}
      </span>
    </div>
  );
}
