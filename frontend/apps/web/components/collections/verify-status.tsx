"use client";

import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { useTranslations } from "next-intl";
import type { VerifyStatus } from "@/lib/server/collections";

const TONE: Record<VerifyStatus, StatusTone> = { pending: "pending", verified: "approved", reconciled: "approved", disputed: "rejected" };

export function VerifyStatusBadge({ status }: { status: VerifyStatus }) {
  const t = useTranslations("collections.status");
  return <StatusBadge tone={TONE[status]}>{t(status)}</StatusBadge>;
}
