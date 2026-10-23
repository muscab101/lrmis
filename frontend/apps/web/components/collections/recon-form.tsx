"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { submitReconAction } from "@/app/[locale]/(staff)/collections/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { DayChannel } from "@/lib/server/collections";

/** Enter what actually came in per way of paying; differences, shortages and excess are worked out as you type. */
export function ReconForm({ cashierId, date, channels }: { cashierId: string; date: string; channels: DayChannel[] }) {
  const t = useTranslations("collections");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const [actual, setActual] = useState<Record<string, string>>(Object.fromEntries(channels.map((c) => [c.channel, c.recorded > 0 || c.suggested > 0 ? String(c.suggested) : ""])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : Math.round(Number(s) * 100) / 100);
  const rows = channels.map((c) => {
    const a = num(actual[c.channel]);
    const diff = a === null ? null : Math.round((a - c.recorded) * 100) / 100;
    return { ...c, a, diff };
  });
  const shown = rows.filter((r) => r.recorded > 0 || (r.a ?? 0) > 0 || r.channel === "cash");
  const totals = shown.reduce(
    (s, r) => ({ recorded: s.recorded + r.recorded, actual: s.actual + (r.a ?? 0), shortage: s.shortage + Math.max(-(r.diff ?? 0), 0), excess: s.excess + Math.max(r.diff ?? 0, 0) }),
    { recorded: 0, actual: 0, shortage: 0, excess: 0 },
  );
  const anyDiff = shown.some((r) => (r.diff ?? 0) !== 0);
  const missing = shown.some((r) => r.recorded > 0 && r.a === null);

  async function submit() {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(shown.filter((r) => r.a !== null).map((r) => [r.channel, r.a!]));
    const res = await submitReconAction({ cashierId, date, actual: body, note });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("recon.submitted"));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recon.channel")}</TableHead>
            <TableHead className="text-end">{t("recon.payments")}</TableHead>
            <TableHead className="text-end">{t("recon.recorded")}</TableHead>
            <TableHead className="w-40 text-end">{t("recon.actual")}</TableHead>
            <TableHead className="text-end">{t("recon.difference")}</TableHead>
            <TableHead className="text-end">{t("recon.shortage")}</TableHead>
            <TableHead className="text-end">{t("recon.excess")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.channel}>
              <TableCell className="text-sm">
                {t(`channels.${r.channel}`)}
                {(r.pending > 0 || r.disputed > 0) && (
                  <span className="block text-xs text-muted-foreground">{t("recon.unchecked", { pending: r.pending, disputed: r.disputed })}</span>
                )}
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{r.payments}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(r.recorded)}</TableCell>
              <TableCell className="text-end">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={`${t("recon.actual")} · ${t(`channels.${r.channel}`)}`}
                  value={actual[r.channel] ?? ""}
                  onChange={(e) => setActual({ ...actual, [r.channel]: e.target.value })}
                  className="text-end tabular-nums"
                />
              </TableCell>
              <TableCell className={`text-end text-sm tabular-nums ${r.diff ? (r.diff < 0 ? "text-status-rejected" : "text-status-pending") : ""}`}>{r.diff === null ? "—" : usd(r.diff)}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{r.diff !== null && r.diff < 0 ? usd(-r.diff) : "—"}</TableCell>
              <TableCell className="text-end text-sm tabular-nums">{r.diff !== null && r.diff > 0 ? usd(r.diff) : "—"}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-medium">
            <TableCell>{t("recon.total")}</TableCell>
            <TableCell />
            <TableCell className="text-end tabular-nums">{usd(totals.recorded)}</TableCell>
            <TableCell className="text-end tabular-nums">{usd(totals.actual)}</TableCell>
            <TableCell className="text-end tabular-nums">{usd(totals.actual - totals.recorded)}</TableCell>
            <TableCell className="text-end tabular-nums">{usd(totals.shortage)}</TableCell>
            <TableCell className="text-end tabular-nums">{usd(totals.excess)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div className="space-y-3 px-4 pb-4">
        <p className="text-xs text-muted-foreground">{t("recon.suggestedHint")}</p>
        <Field id="reconNote" label={anyDiff ? t("recon.noteRequired") : t("recon.note")} error={vm(error?.fieldErrors?.note?.[0])} required={anyDiff}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        {error?.fieldErrors?.actual && <p className="text-sm text-destructive">{t("recon.fillAll")}</p>}
        <FormError error={error && !error.fieldErrors ? error : null} />
        <div className="flex justify-end">
          <Button loading={busy} disabled={missing} onClick={() => void submit()}>
            {t("recon.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
