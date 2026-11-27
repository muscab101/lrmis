"use client";

import { Building2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type Office, officeLabel } from "@/lib/office";

/** "Assigned office: Hodan District Office", with an office icon. compact: just the icon and the name. */
export function OfficeBadge({ office, compact = false, className = "" }: { office: Office | null; compact?: boolean; className?: string }) {
  const t = useTranslations("office");
  const locale = useLocale();
  const label = officeLabel(office, locale, t);
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 text-sm ${compact ? "rounded-md border bg-card px-2 py-1 text-xs" : ""} ${className}`}
      title={`${t("assigned")}: ${label}`}
    >
      <Building2 className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate font-medium">{label}</span>
    </span>
  );
}
