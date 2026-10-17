"use client";

import { ACTIONS, MODULES, specialPermissionsFor, type Action, type Module } from "@dhulka/core/permissions";
import { Checkbox } from "@dhulka/ui/form-controls";
import { cn } from "@dhulka/ui/lib/cn";
import { useTranslations } from "next-intl";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Permissions the editor may grant; others are shown but disabled (no escalation). */
  grantable: (perm: string) => boolean;
  readOnly?: boolean;
}

/** Rows = modules, columns = actions, plus special permissions per module. */
export function PermissionMatrix({ value, onChange, grantable, readOnly = false }: Props) {
  const t = useTranslations("permissions");
  const selected = new Set(value);

  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const k of keys) {
      if (!grantable(k) && on) continue;
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange([...next].sort());
  };

  const state = (keys: string[]): boolean | "indeterminate" => {
    const n = keys.filter((k) => selected.has(k)).length;
    return n === 0 ? false : n === keys.length ? true : "indeterminate";
  };

  const columnKeys = (a: Action) => MODULES.map((m) => `${m}.${a}`);
  const rowKeys = (m: Module) => [...ACTIONS.map((a) => `${m}.${a}`), ...specialPermissionsFor(m)];

  return (
    <div className="relative overflow-x-auto rounded-md border">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead className="bg-muted/50">
          <tr className="border-b">
            <th scope="col" className="sticky start-0 bg-muted/50 px-3 py-2 text-start text-xs font-medium text-muted-foreground">
              {t("module")}
            </th>
            {ACTIONS.map((a) => (
              <th key={a} scope="col" className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                <div className="flex flex-col items-center gap-1.5">
                  {t(`actions.${a}`)}
                  {!readOnly && (
                    <Checkbox
                      aria-label={t("selectColumn", { action: t(`actions.${a}`) })}
                      checked={state(columnKeys(a))}
                      onCheckedChange={(v) => toggle(columnKeys(a), v === true)}
                    />
                  )}
                </div>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">
              {t("special")}
            </th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m} className="border-b last:border-0 hover:bg-muted/30">
              <th scope="row" className="sticky start-0 bg-card px-3 py-2 text-start font-medium">
                <div className="flex items-center gap-2">
                  {!readOnly && (
                    <Checkbox
                      aria-label={t("selectRow", { module: t(`modules.${m}`) })}
                      checked={state(rowKeys(m))}
                      onCheckedChange={(v) => toggle(rowKeys(m), v === true)}
                    />
                  )}
                  {t(`modules.${m}`)}
                </div>
              </th>
              {ACTIONS.map((a) => {
                const key = `${m}.${a}`;
                const can = grantable(key) || selected.has(key);
                return (
                  <td key={a} className="px-2 py-2 text-center">
                    <Checkbox
                      aria-label={`${t(`modules.${m}`)} — ${t(`actions.${a}`)}`}
                      checked={selected.has(key)}
                      disabled={readOnly || !can}
                      onCheckedChange={(v) => toggle([key], v === true)}
                      className={cn(!can && "opacity-30")}
                    />
                  </td>
                );
              })}
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {specialPermissionsFor(m).map((key) => (
                    <label key={key} className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                      <Checkbox
                        checked={selected.has(key)}
                        disabled={readOnly || (!grantable(key) && !selected.has(key))}
                        onCheckedChange={(v) => toggle([key], v === true)}
                      />
                      {t(`specials.${key.replace(".", "_")}`)}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
