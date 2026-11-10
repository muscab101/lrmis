"use client";

import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { useTranslations } from "next-intl";
import type { InvoiceStatus, RunStatus } from "@/lib/server/billing";

const RUN_TONE: Record<RunStatus, StatusTone> = { draft: "draft", submitted: "pending", approved: "partial", generating: "partial", issued: "approved", cancelled: "rejected" };

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations("billing.runStatus");
  return <StatusBadge tone={RUN_TONE[status]}>{t(status)}</StatusBadge>;
}

/** Overdue isn't stored: it's an open invoice past its due date. */
export function InvoiceStatusBadge({ status, dueDate }: { status: InvoiceStatus; dueDate: string }) {
  const ti = useTranslations("billing.invoiceStatus");
  const overdue = (status === "issued" || status === "partially_paid") && dueDate < new Date().toISOString().slice(0, 10);
  if (overdue) return <StatusBadge tone="rejected">{ti("overdue")}</StatusBadge>;
  const tone: Record<InvoiceStatus, StatusTone> = { issued: "pending", partially_paid: "partial", paid: "paid", cancelled: "draft" };
  return <StatusBadge tone={tone[status]}>{ti(status)}</StatusBadge>;
}
