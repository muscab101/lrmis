"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Alert } from "@dhulka/ui/misc";
import { Printer, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  printStatusAction,
  sendBulkToPrinterAction,
  sendCardToCashierAction,
  sendToPrinterAction,
} from "@/app/[locale]/(staff)/documents/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";

type Choice = { id: string; code: string; name: string; location: string; online: boolean };
type JobState = {
  document_id: string;
  status: "queued" | "printing" | "printed" | "failed";
  error: string | null;
  printer_name: string;
};

/** Follows the print queue for these documents until nothing is waiting. */
function useQueue(ids: string[], started: number) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobState[]>([]);
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const r = await printStatusAction({ ids: key.split(",") });
      if (!live || !r.ok) return;
      setJobs((prev) => {
        // Something just finished: the page reloads to show it as printed.
        if (
          prev.some(
            (p) =>
              p.status !== "printed" &&
              r.data.some((n) => n.document_id === p.document_id && n.status === "printed"),
          )
        )
          router.refresh();
        return r.data;
      });
      if (r.data.some((j) => j.status === "queued" || j.status === "printing"))
        timer = setTimeout(() => void check(), 3000);
    };
    void check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, started, router]);
  return jobs;
}

/** Choose an added printer. Nothing else can print official copies. */
function PrinterSelect({
  printers,
  value,
  onChange,
}: {
  printers: Choice[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("documents");
  return (
    <NativeSelect
      aria-label={t("choosePrinter")}
      className="h-10 min-w-56"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t("choosePrinter")}</option>
      {printers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.location}
          {p.online ? "" : ` (${t("printerOffline")})`}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The sheet on screen: always a preview. It cannot be printed from the browser; paper comes only from an added printer. */
function Preview({ fixed = false, children }: { fixed?: boolean; children: React.ReactNode }) {
  const t = useTranslations("documents");
  return (
    <>
      <p className="hidden p-8 text-center text-lg print:block">{t("browserPrintOff")}</p>
      <div className="relative print:hidden">
        <div
          aria-hidden
          className={`pointer-events-none ${fixed ? "fixed" : "absolute"} inset-0 z-10 grid place-items-center overflow-hidden`}
        >
          <span className="-rotate-30 select-none whitespace-nowrap text-[64px] font-bold tracking-widest text-red-600/15">
            {t("previewWatermark")}
          </span>
        </div>
        {children}
      </div>
    </>
  );
}

/** One document: pick an added printer and send it. The job is followed until it is printed or fails. */
export function PrintControls({
  id,
  printed,
  status,
  canPrint,
  printers,
  payment = null,
  children,
}: {
  id: string;
  printed: boolean;
  status: string;
  canPrint: boolean;
  /** The added printers this person may use. */
  printers: Choice[];
  /** An ID card whose print bill isn't paid yet: printing waits for the cashier. */
  payment?: { invoiceNumber: string | null } | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("documents");
  const locale = useLocale() as "so" | "en";
  const [printer, setPrinter] = useState(printers.length === 1 ? printers[0]!.id : "");
  const [started, setStarted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const job = useQueue(canPrint ? [id] : [], started)[0];
  const waiting = job?.status === "queued" || job?.status === "printing";
  // The bill number once sent to the cashier from here.
  const [sent, setSent] = useState<string | null>(null);
  const billNumber = sent ?? payment?.invoiceNumber ?? null;
  const blocked =
    status !== "valid"
      ? t("printCancelled")
      : printed
        ? t("printAlreadyDone")
        : !canPrint
          ? t("printNoPermission")
          : payment
            ? billNumber
              ? t("cardPayOpen", { number: billNumber })
              : t("cardPayNone")
            : printers.length === 0
              ? t("noPrinters")
              : null;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
        {blocked ? (
          <>
            <Alert tone="warning" title={blocked} className="w-full" />
            {/* No print bill yet: send it to the district's cashier; printing waits until it is paid. */}
            {payment && !billNumber && status === "valid" && !printed && canPrint && (
              <>
                <FormError error={error} />
                <Button
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    const res = await sendCardToCashierAction({ id });
                    setBusy(false);
                    if (!res.ok) return setError(res.error);
                    setSent(res.data ?? null);
                  }}
                >
                  <Send aria-hidden />
                  {t("cardSendToCashier")}
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <FormError error={error} />
            {job && (
              <Alert
                tone={job.status === "failed" ? "danger" : "info"}
                title={t(`job.${job.status}`, { printer: job.printer_name })}
                className="w-full"
              >
                {job.status === "failed" && job.error ? job.error : undefined}
              </Alert>
            )}
            <PrinterSelect printers={printers} value={printer} onChange={setPrinter} />
            <Button
              loading={busy}
              disabled={!printer || waiting}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await sendToPrinterAction({ id, printerId: printer, locale });
                setBusy(false);
                if (!res.ok) return setError(res.error);
                setStarted((n) => n + 1);
              }}
            >
              <Printer aria-hidden />
              {t("sendToPrinter")}
            </Button>
          </>
        )}
      </div>
      <Preview>{children}</Preview>
    </>
  );
}

/** The batch version: sends every ready document to one added printer and follows them. */
export function BatchPrintControls({
  ids,
  canPrint,
  printers,
  children,
}: {
  ids: string[];
  canPrint: boolean;
  printers: Choice[];
  children: React.ReactNode;
}) {
  const t = useTranslations("documents");
  const locale = useLocale() as "so" | "en";
  const [printer, setPrinter] = useState(printers.length === 1 ? printers[0]!.id : "");
  const [started, setStarted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [failed, setFailed] = useState<{ id: string; serial: string | null; error: string }[]>([]);
  const jobs = useQueue(canPrint ? ids : [], started);
  const count = (s: JobState["status"]) => jobs.filter((j) => j.status === s).length;
  const waiting = count("queued") + count("printing");
  const blocked =
    ids.length === 0
      ? t("batchNothing")
      : !canPrint
        ? t("printNoPermission")
        : printers.length === 0
          ? t("noPrinters")
          : null;
  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
        {blocked ? (
          <Alert tone="warning" title={blocked} className="w-full" />
        ) : (
          <>
            <FormError error={error} />
            {failed.length > 0 && (
              <Alert
                tone="warning"
                title={t("batchFailed", { count: failed.length })}
                className="w-full"
              >
                {failed.map((f) => f.serial).join(", ")}
              </Alert>
            )}
            {jobs.length > 0 && (
              <Alert
                tone={count("failed") ? "danger" : "info"}
                title={t("batchProgress", {
                  printed: count("printed"),
                  waiting,
                  failed: count("failed"),
                })}
                className="w-full"
              />
            )}
            <span className="text-muted-foreground me-auto text-sm">
              {t("batchCount", { count: ids.length })}
            </span>
            <PrinterSelect printers={printers} value={printer} onChange={setPrinter} />
            <Button
              loading={busy}
              disabled={!printer || waiting > 0}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await sendBulkToPrinterAction({ ids, printerId: printer, locale });
                setBusy(false);
                if (!res.ok) return setError(res.error);
                setFailed(res.data.failed);
                setStarted((n) => n + 1);
              }}
            >
              <Printer aria-hidden />
              {t("sendAllToPrinter", { count: ids.length })}
            </Button>
          </>
        )}
      </div>
      <Preview fixed>{children}</Preview>
    </>
  );
}
