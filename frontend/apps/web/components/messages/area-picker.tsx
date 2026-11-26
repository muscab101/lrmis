"use client";

import { Checkbox } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { ChevronRight, Loader2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type AreaChoice, composeAreasAction } from "@/app/[locale]/(staff)/messages/actions";

export const AREA_LEVELS = ["district", "section", "sector", "neighbourhood"] as const;
export type AreaLevel = (typeof AREA_LEVELS)[number];
export interface PickedArea {
  level: AreaLevel;
  id: string;
  code: string;
  name: string;
}

/**
 * Districts → sections → sectors → neighbourhoods, side by side: open a place to see the places inside it, tick a place
 * to choose all of it. Only places the user may choose can be ticked (others only open the way down).
 */
export function AreaPicker({
  value,
  onChange,
  selectable = AREA_LEVELS,
  showOwners = true,
}: {
  value: PickedArea[];
  onChange: (next: PickedArea[]) => void;
  /** Which levels can be ticked. */
  selectable?: readonly AreaLevel[];
  showOwners?: boolean;
}) {
  const t = useTranslations("messages.compose");
  const locale = useLocale();
  const [open, setOpen] = useState<Partial<Record<AreaLevel, string>>>({});
  const [lists, setLists] = useState<Record<string, AreaChoice[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<Partial<Record<AreaLevel, string>>>({});

  const keyOf = (level: AreaLevel, parent: string | null) => `${level}:${parent ?? ""}`;
  const load = async (level: AreaLevel, parent: string | null) => {
    const key = keyOf(level, parent);
    if (lists[key]) return;
    setLoading(key);
    const r = await composeAreasAction({ level, parent });
    setLoading(null);
    if (r.ok) setLists((l) => ({ ...l, [key]: r.data }));
  };

  useEffect(() => {
    void load("district", null);
    // Loads once; the lists are kept while the picker is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = (a: AreaChoice) => (locale === "so" ? a.name_so : a.name_en);
  const picked = (level: AreaLevel, id: string) => value.some((v) => v.level === level && v.id === id);
  const toggle = (level: AreaLevel, a: AreaChoice) =>
    onChange(picked(level, a.id) ? value.filter((v) => !(v.level === level && v.id === a.id)) : [...value, { level, id: a.id, code: a.code, name: name(a) }]);

  const columns = AREA_LEVELS.map((level, i) => {
    const parentLevel = i === 0 ? null : AREA_LEVELS[i - 1]!;
    const parent = parentLevel ? (open[parentLevel] ?? null) : null;
    return { level, parent, show: i === 0 || parent !== null };
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {columns.map(({ level, parent, show }, i) => {
          const key = keyOf(level, parent);
          const rows = (lists[key] ?? []).filter((a) => {
            const q = (filter[level] ?? "").trim().toLowerCase();
            return !q || name(a).toLowerCase().includes(q) || a.code.toLowerCase().includes(q);
          });
          return (
            <div key={level} className="flex min-h-48 flex-col rounded-md border">
              <div className="border-b px-3 py-2">
                <p className="label-caps text-muted-foreground">{t(`levels.${level}`)}</p>
                {show && (lists[key]?.length ?? 0) > 8 && (
                  <Input
                    className="mt-1.5 h-7 text-xs"
                    placeholder={t("filter")}
                    aria-label={t("filter")}
                    value={filter[level] ?? ""}
                    onChange={(e) => setFilter((f) => ({ ...f, [level]: e.target.value }))}
                  />
                )}
              </div>
              <ul className="max-h-64 flex-1 overflow-y-auto p-1 text-sm">
                {!show && <li className="px-2 py-3 text-xs text-muted-foreground">{t("openAbove", { level: t(`levels.${AREA_LEVELS[i - 1]!}`) })}</li>}
                {show && loading === key && (
                  <li className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t("loading")}
                  </li>
                )}
                {show && loading !== key && lists[key]?.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">{t("nothingHere")}</li>}
                {show &&
                  rows.map((a) => {
                    const canTick = a.allowed && selectable.includes(level);
                    const isOpen = open[level] === a.id;
                    return (
                      <li key={a.id} className={`flex items-center gap-2 rounded px-2 py-1 ${isOpen ? "bg-muted" : "hover:bg-muted/50"}`}>
                        <Checkbox
                          checked={picked(level, a.id)}
                          disabled={!canTick}
                          aria-label={t("choose", { name: name(a) })}
                          onCheckedChange={() => toggle(level, a)}
                        />
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                          disabled={i === AREA_LEVELS.length - 1}
                          onClick={() => {
                            const next = AREA_LEVELS[i + 1];
                            if (!next) return;
                            // Opening a place closes everything below it.
                            setOpen((o) => {
                              const n: Partial<Record<AreaLevel, string>> = {};
                              for (const l of AREA_LEVELS.slice(0, i)) if (o[l]) n[l] = o[l];
                              n[level] = a.id;
                              return n;
                            });
                            void load(next, a.id);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <span className="me-1.5 font-mono text-[11px] text-muted-foreground">{a.code}</span>
                            {name(a)}
                          </span>
                          {showOwners && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{a.owners}</span>}
                          {i < AREA_LEVELS.length - 1 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={`${v.level}:${v.id}`} className="inline-flex items-center gap-1.5 rounded-md border bg-card py-1 ps-2 pe-1 text-xs">
              <span className="text-muted-foreground">{t(`levels.${v.level}`)}</span>
              <span className="font-medium">{v.name}</span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("remove", { name: v.name })}
                onClick={() => onChange(value.filter((x) => !(x.level === v.level && x.id === v.id)))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
