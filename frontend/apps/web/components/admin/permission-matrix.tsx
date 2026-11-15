"use client";
import { zebraRows } from "@dhulka/ui/table";

import { ACTIONS, MODULES, specialPermissionsFor, type Action } from "@dhulka/core/permissions";
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

/** One row of the grid: a label, the power behind each action column (none = empty cell), and its extra powers. */
interface Row {
  id: string;
  cells: Partial<Record<Action, string>>;
  specials: string[];
}

/** Powers that belong to registered land / owners; the rest of the Parcels and Owners powers are for partial ones. */
const REGISTERED: Record<"parcels" | "owners", { cells: Partial<Record<Action, string>>; specials: string[] }> = {
  parcels: {
    cells: { view: "parcels.registered", delete: "parcels.delete_registered" },
    specials: ["parcels.demolitions", "parcels.demolish", "parcels.demolish_approve"],
  },
  owners: { cells: { view: "owners.registered", delete: "owners.delete_registered" }, specials: [] },
};

const grid = (m: string): Partial<Record<Action, string>> => Object.fromEntries(ACTIONS.map((a) => [a, `${m}.${a}`]));

/**
 * The rows: one per part of the system. Parcels and Owners are split in two, Partial (not registered yet) and Registered.
 * Parts no longer used are not offered (Disputes, liens and court orders; Permits).
 */
const ROWS: Row[] = MODULES.filter((m) => m !== "disputes" && m !== "permits").flatMap((m): Row[] => {
  if (m !== "parcels" && m !== "owners") return [{ id: m, cells: grid(m), specials: specialPermissionsFor(m) }];
  const reg = REGISTERED[m];
  const registeredKeys = new Set([...Object.values(reg.cells), ...reg.specials]);
  return [
    { id: `${m}_partial`, cells: grid(m), specials: specialPermissionsFor(m).filter((k) => !registeredKeys.has(k)) },
    { id: `${m}_registered`, cells: reg.cells, specials: reg.specials },
  ];
});

/** Rows = parts of the system, columns = actions, plus each row's extra powers. */
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

  const columnKeys = (a: Action) => ROWS.flatMap((r) => (r.cells[a] ? [r.cells[a]] : []));
  const rowKeys = (r: Row) => [...Object.values(r.cells), ...r.specials];
  const label = (r: Row) => t(`modules.${r.id}`);

  return (
    <div className="relative overflow-x-auto rounded-md border">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead className="bg-muted/50">
          <tr className="border-b">
            <th scope="col" className="bg-muted/50 text-muted-foreground sticky start-0 px-3 py-2 text-start text-xs font-medium">
              {t("module")}
            </th>
            {ACTIONS.map((a) => (
              <th key={a} scope="col" className="text-muted-foreground px-2 py-2 text-center text-xs font-medium">
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
            <th scope="col" className="text-muted-foreground px-3 py-2 text-start text-xs font-medium">
              {t("special")}
            </th>
          </tr>
        </thead>
        <tbody className={zebraRows}>
          {ROWS.map((r) => (
            <tr key={r.id} className={cn("hover:bg-muted/30 border-b last:border-0", r.id.endsWith("_partial") && "border-dashed")}>
              <th scope="row" className="bg-card sticky start-0 px-3 py-2 text-start font-medium">
                <div className="flex items-center gap-2">
                  {!readOnly && (
                    <Checkbox
                      aria-label={t("selectRow", { module: label(r) })}
                      checked={state(rowKeys(r))}
                      onCheckedChange={(v) => toggle(rowKeys(r), v === true)}
                    />
                  )}
                  {label(r)}
                </div>
              </th>
              {ACTIONS.map((a) => {
                const key = r.cells[a];
                if (!key) {
                  return (
                    <td key={a} className="text-muted-foreground/40 px-2 py-2 text-center" aria-hidden>
                      —
                    </td>
                  );
                }
                const can = grantable(key) || selected.has(key);
                return (
                  <td key={a} className="px-2 py-2 text-center">
                    <Checkbox
                      aria-label={`${label(r)} — ${t(`actions.${a}`)}`}
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
                  {r.specials.map((key) => (
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
