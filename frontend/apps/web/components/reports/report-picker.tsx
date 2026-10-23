"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { useRouter } from "@/i18n/navigation";

interface Props {
  label: string;
  current: string;
  /** Reports by subject; each href keeps the page's place and period. */
  groups: { label: string; reports: { value: string; label: string; href: string }[] }[];
}

/** Choose a report from one dropdown, grouped by subject (Money, Land, Documents). */
export function ReportPicker({ label, current, groups }: Props) {
  const router = useRouter();
  const hrefs = new Map(groups.flatMap((g) => g.reports.map((r) => [r.value, r.href] as const)));
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <NativeSelect value={current} onChange={(e) => router.push(hrefs.get(e.target.value)!)} className="w-auto min-w-64 font-medium">
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.reports.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </optgroup>
        ))}
      </NativeSelect>
    </label>
  );
}
