"use client";

import { useTranslations } from "next-intl";
import { SendToPrinter } from "@/components/printing/send-to-printer";

/** Print an invoice: choose one of the printers registered for this person; it is sent there. No page opens. */
export function InvoicePrintNow({ id, iconOnly = false, variant = "outline" }: { id: string; iconOnly?: boolean; variant?: "outline" | "ghost" | "default" }) {
  const t = useTranslations("billing");
  return <SendToPrinter kind="invoice" id={id} label={iconOnly ? t("printInvoice") : t("print")} iconOnly={iconOnly} variant={variant} />;
}
