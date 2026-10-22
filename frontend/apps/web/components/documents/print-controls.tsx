"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Alert } from "@dhulka/ui/misc";
import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { printBulkAction, printDocumentAction } from "@/app/[locale]/(staff)/documents/actions";
import { FormError } from "@/components/forms/form-error";

/**
 * Screen copies carry a PREVIEW watermark. The official print is logged first (once); after that
 * the watermark goes and the browser print dialog opens.
 */
export function PrintControls({ id, printed, status, canPrint, children }: { id: string; printed: boolean; status: string; canPrint: boolean; children: React.ReactNode }) {
  const t = useTranslations("documents");
  const [official, setOfficial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const blocked = status !== "valid" ? t("printCancelled") : printed && !official ? t("printAlreadyDone") : !canPrint ? t("printNoPermission") : null;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
        {blocked ? (
          <Alert tone="warning" title={blocked} className="w-full" />
        ) : (
          <>
            <FormError error={error} />
            <Button
              loading={busy}
              onClick={async () => {
                if (!official) {
                  setBusy(true);
                  setError(null);
                  const res = await printDocumentAction({ id });
                  setBusy(false);
                  if (!res.ok) return setError(res.error);
                  setOfficial(true);
                }
                setTimeout(() => window.print(), 50);
              }}
            >
              <Printer aria-hidden />
              {official ? t("printAgainDialog") : t("printOfficial")}
            </Button>
          </>
        )}
      </div>
      <div className="relative">
        {!official && (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden">
            <span className="-rotate-30 text-[64px] font-bold tracking-widest whitespace-nowrap text-red-600/15 select-none">{t("previewWatermark")}</span>
          </div>
        )}
        {children}
      </div>
    </>
  );
}

/** The batch version: logs every document's first print in one call, then opens the print dialog once. */
export function BatchPrintControls({ ids, canPrint, children }: { ids: string[]; canPrint: boolean; children: React.ReactNode }) {
  const t = useTranslations("documents");
  const [official, setOfficial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [failed, setFailed] = useState<{ id: string; serial: string | null; error: string }[]>([]);
  const blocked = ids.length === 0 ? t("batchNothing") : !canPrint ? t("printNoPermission") : null;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
        {blocked ? (
          <Alert tone="warning" title={blocked} className="w-full" />
        ) : (
          <>
            <FormError error={error} />
            {failed.length > 0 && (
              <Alert tone="warning" title={t("batchFailed", { count: failed.length })} className="w-full">
                {failed.map((f) => f.serial).join(", ")}
              </Alert>
            )}
            <span className="me-auto text-sm text-muted-foreground">{t("batchCount", { count: ids.length })}</span>
            <Button
              loading={busy}
              onClick={async () => {
                if (!official) {
                  setBusy(true);
                  setError(null);
                  const res = await printBulkAction({ ids });
                  setBusy(false);
                  if (!res.ok) return setError(res.error);
                  setFailed(res.data.failed);
                  setOfficial(true);
                }
                setTimeout(() => window.print(), 50);
              }}
            >
              <Printer aria-hidden />
              {official ? t("printAgainDialog") : t("printOfficialAll", { count: ids.length })}
            </Button>
          </>
        )}
      </div>
      <div className="relative">
        {!official && (
          // Fixed, so it sits over every sheet on screen and repeats on every page of an unofficial print.
          <div aria-hidden className="pointer-events-none fixed inset-0 z-10 grid place-items-center overflow-hidden">
            <span className="-rotate-30 text-[64px] font-bold tracking-widest whitespace-nowrap text-red-600/15 select-none">{t("previewWatermark")}</span>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
