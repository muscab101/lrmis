"use client";

import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { useLocale, useTranslations } from "next-intl";

const USER_TONE: Record<string, StatusTone> = {
  active: "approved",
  invited: "partial",
  suspended: "rejected",
  deleted: "draft",
};

export function UserStatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <StatusBadge tone={USER_TONE[status] ?? "draft"}>{t(status as "active")}</StatusBadge>;
}

export function RoleBadge({ role }: { role: { name_so: string; name_en: string; colour: string } }) {
  const locale = useLocale();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border bg-card px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap"
      style={{ borderColor: `${role.colour}55`, color: role.colour }}
    >
      <span className="size-1.5 rotate-45" style={{ backgroundColor: role.colour }} aria-hidden />
      {locale === "so" ? role.name_so : role.name_en}
    </span>
  );
}
