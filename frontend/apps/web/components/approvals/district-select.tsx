"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { useRouter } from "@/i18n/navigation";

/** Choose one district (each district works its own); the list follows at once. */
export function DistrictSelect({
  value,
  options,
  allLabel,
  label,
  hrefFor,
}: {
  value: string | null;
  options: { code: string; name: string; count: number }[];
  allLabel: string;
  label: string;
  /** The page address for each choice ("" = all districts). */
  hrefFor: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <NativeSelect aria-label={label} className="h-9 w-auto min-w-48" value={value ?? ""} onChange={(e) => router.push(hrefFor[e.target.value] ?? hrefFor[""]!)}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name} ({o.count})
        </option>
      ))}
    </NativeSelect>
  );
}
