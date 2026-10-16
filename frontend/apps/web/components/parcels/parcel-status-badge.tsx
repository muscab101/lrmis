"use client";

import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { useTranslations } from "next-intl";
import type { ParcelStatus } from "@/lib/server/parcels";

const TONE: Record<ParcelStatus, StatusTone> = {
  draft: "draft",
  surveyed: "partial",
  verified: "pending",
  registered: "approved",
  disputed: "rejected",
  archived: "draft",
};

export function ParcelStatusBadge({ status }: { status: ParcelStatus }) {
  const t = useTranslations("stage.parcelStatus");
  return <StatusBadge tone={TONE[status]}>{t(status)}</StatusBadge>;
}
