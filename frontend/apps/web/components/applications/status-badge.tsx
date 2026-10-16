"use client";

import type { ApplicationStatus } from "@dhulka/core/schemas";
import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { useTranslations } from "next-intl";

const TONE: Record<ApplicationStatus, StatusTone> = {
  draft: "draft",
  awaiting_payment: "pending",
  in_survey: "partial",
  surveyed: "partial",
  in_verification: "pending",
  returned: "rejected",
  public_notice: "partial",
  approved: "approved",
  rejected: "rejected",
  cancelled: "draft",
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations("applications.status");
  return <StatusBadge tone={TONE[status]}>{t(status)}</StatusBadge>;
}
