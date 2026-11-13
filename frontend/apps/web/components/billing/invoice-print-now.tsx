"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { invoicePrintNowAction } from "@/app/[locale]/(staff)/billing/actions";
import { useErrorMessage } from "@/lib/client/errors";

/** Print an invoice: sent straight to the printer at this person's point of sale. No page opens. */
export function InvoicePrintNow({ id, iconOnly = false, variant = "outline" }: { id: string; iconOnly?: boolean; variant?: "outline" | "ghost" | "default" }) {
  const t = useTranslations("billing");
  const td = useTranslations("documents");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    const res = await invoicePrintNowAction({ id, locale: locale === "en" ? "en" : "so" });
    setBusy(false);
    if (!res.ok) return void toast.error(errorMessage(res.error));
    toast.success(res.data.online ? td("printNowSent", { printer: res.data.printer }) : td("printNowQueued", { printer: res.data.printer }));
  };
  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label={t("printInvoice")} title={t("printInvoice")} loading={busy} onClick={print}>
        <Printer aria-hidden />
      </Button>
    );
  }
  return (
    <Button size="sm" variant={variant} loading={busy} onClick={print}>
      <Printer aria-hidden />
      {busy ? td("printNowSending") : t("print")}
    </Button>
  );
}
