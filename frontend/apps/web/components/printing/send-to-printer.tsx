"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { Loader2, Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { myPrintersAction, sendToPrinterAction } from "@/app/[locale]/(staff)/printers/actions";
import { useErrorMessage } from "@/lib/client/errors";

type Choice = { id: string; name: string; location: string | null; online: boolean; pos_name: string | null; mine: boolean };

/**
 * Print an invoice or a receipt without opening another tab: the printers registered for this person are listed, they
 * choose one, and the job goes to that printer's print program.
 */
export function SendToPrinter({
  kind,
  id,
  label,
  iconOnly = false,
  variant = "outline",
}: {
  kind: "invoice" | "receipt";
  id: string;
  label: string;
  iconOnly?: boolean;
  variant?: "outline" | "ghost" | "default";
}) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [sending, setSending] = useState(false);

  const start = async () => {
    setOpen(true);
    setChoices(null);
    const res = await myPrintersAction({});
    if (!res.ok) {
      setOpen(false);
      return void toast.error(errorMessage(res.error));
    }
    setChoices(res.data);
    // This person's own desk printer first, else the first one that is on.
    setChosen((res.data.find((c) => c.mine) ?? res.data.find((c) => c.online) ?? res.data[0])?.id ?? "");
  };

  const send = async () => {
    setSending(true);
    const res = await sendToPrinterAction({ kind, id, printerId: chosen, locale: locale === "en" ? "en" : "so" });
    setSending(false);
    if (!res.ok) return void toast.error(errorMessage(res.error));
    toast.success(res.data.online ? t("printNowSent", { printer: res.data.printer }) : t("printNowQueued", { printer: res.data.printer }));
    setOpen(false);
  };

  return (
    <>
      {iconOnly ? (
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={() => void start()}>
          <Printer aria-hidden />
        </Button>
      ) : (
        <Button size="sm" variant={variant} onClick={() => void start()}>
          <Printer aria-hidden />
          {label}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("choosePrinter")}</DialogTitle>
            <DialogDescription>{label}</DialogDescription>
          </DialogHeader>
          {choices === null ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </p>
          ) : choices.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noPrinters")}</p>
          ) : (
            <ul className="divide-y rounded-md border" role="radiogroup" aria-label={t("choosePrinter")}>
              {choices.map((c) => (
                <li key={c.id}>
                  <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="radio" name="printer" className="accent-primary size-4" checked={chosen === c.id} onChange={() => setChosen(c.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">{[c.pos_name, c.location].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`flex items-center gap-1.5 text-xs ${c.online ? "text-status-approved" : "text-muted-foreground"}`}>
                      <span className={`size-2 rounded-full ${c.online ? "bg-status-approved" : "bg-muted-foreground/40"}`} aria-hidden />
                      {c.online ? t("printerOnline") : t("printerOffline")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancelPrint")}
            </Button>
            <Button disabled={!chosen || !choices?.length} loading={sending} onClick={() => void send()}>
              <Printer aria-hidden />
              {t("sendToPrinter")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
