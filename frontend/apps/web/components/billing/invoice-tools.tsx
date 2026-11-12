"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { Input } from "@dhulka/ui/input";
import { CopyCheck, ExternalLink, FilePlus2, PenLine, XCircle } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelInvoiceAction,
  checkDuplicatesAction,
  checkMissingAction,
  createMissingAction,
  editInvoiceAmountAction,
  fixDuplicatesAction,
  type DuplicateCopy,
  type MissingBill,
} from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import { fullHouseNo } from "@/lib/house-no";

/** Check for bills raised twice (one stays, the others are cancelled), and for bills a parcel should have and doesn't. */
export function InvoiceTools({
  canFixDuplicates,
  canCreateMissing,
  canEditAmount,
}: {
  canFixDuplicates: boolean;
  canCreateMissing: boolean;
  canEditAmount: boolean;
}) {
  const t = useTranslations("billing.tools");
  const format = useFormatter();
  const locale = useLocale();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const fee = (x: { fee_so: string; fee_en: string }) => (locale === "so" ? x.fee_so : x.fee_en);
  const [busy, setBusy] = useState<"duplicates" | "missing" | null>(null);
  const [copies, setCopies] = useState<DuplicateCopy[] | null>(null);
  const [missing, setMissing] = useState<MissingBill[] | null>(null);
  const removable = copies?.filter((c) => !c.keep && !c.has_money).length ?? 0;
  const failed = () => toast.error(t("checkFailed"));
  const reload = async () => {
    const res = await checkDuplicatesAction({});
    if (res.ok) setCopies(res.data ?? []);
  };

  return (
    <>
      {canFixDuplicates && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy === "duplicates"}
          onClick={async () => {
            setBusy("duplicates");
            const res = await checkDuplicatesAction({});
            setBusy(null);
            if (res.ok) setCopies(res.data ?? []);
            else failed();
          }}
        >
          <CopyCheck aria-hidden />
          {t("duplicates")}
        </Button>
      )}
      {canCreateMissing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy === "missing"}
          onClick={async () => {
            setBusy("missing");
            const res = await checkMissingAction({});
            setBusy(null);
            if (res.ok) setMissing(res.data ?? []);
            else failed();
          }}
        >
          <FilePlus2 aria-hidden />
          {t("missing")}
        </Button>
      )}

      {copies && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setCopies(null)}
          className="sm:max-w-xl"
          title={t("duplicatesTitle")}
          description={copies.length === 0 ? t("duplicatesNone") : removable > 0 ? t("duplicatesBody", { count: removable }) : t("duplicatesOnlyMoney")}
          confirmLabel={removable > 0 ? t("duplicatesFix") : t("close")}
          destructive={removable > 0}
          hideCancel={removable === 0}
          submit={() => (removable > 0 ? fixDuplicatesAction({}) : Promise.resolve({ ok: true as const, data: null }))}
          onDone={(d) => {
            const r = d as { cancelled: number; left: number } | null;
            if (r) toast.success(t("duplicatesDone", { count: r.cancelled }));
          }}
        >
          {() =>
            copies.length > 0 && (
              <div className="space-y-2">
                <ul className="max-h-96 divide-y overflow-auto rounded-md border text-sm">
                  {copies.map((c) => (
                    <CopyRow key={c.id} copy={c} label={`${c.pun ?? "—"} · ${fee(c)} · ${usd(c.total)}`} canCancel={canFixDuplicates} canEdit={canEditAmount} onChanged={reload} />
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">{t("guardNote")}</p>
              </div>
            )
          }
        </FormDialog>
      )}

      {missing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setMissing(null)}
          className="sm:max-w-xl"
          title={t("missingTitle")}
          description={missing.length === 0 ? t("missingNone") : t("missingBody", { count: missing.length })}
          confirmLabel={missing.length > 0 ? t("missingCreate") : t("close")}
          hideCancel={missing.length === 0}
          submit={() => (missing.length > 0 ? createMissingAction({ parcelIds: [...new Set(missing.map((m) => m.parcel_id))] }) : Promise.resolve({ ok: true as const, data: null }))}
          onDone={(d) => {
            if (d !== null) toast.success(t("missingDone", { count: Number(d) }));
          }}
        >
          {() =>
            missing.length > 0 && (
              <ul className="max-h-80 divide-y overflow-auto rounded-md border text-sm">
                {missing.map((m) => (
                  <li key={`${m.parcel_id}-${m.code}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs">{m.pun ?? fullHouseNo(m.neighbourhood_code, m.house_no) ?? "—"}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[fee(m), m.owners].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{usd(m.amount)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </FormDialog>
      )}
    </>
  );
}

/** One copy in the duplicates list: open it, change its amount, or cancel just this one. */
function CopyRow({
  copy: c,
  label,
  canCancel,
  canEdit,
  onChanged,
}: {
  copy: DuplicateCopy;
  label: string;
  canCancel: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("billing.tools");
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<"edit" | "cancel" | null>(null);
  const [total, setTotal] = useState(String(c.total));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const res =
      mode === "edit" ? await editInvoiceAmountAction({ id: c.id, total: Number(total), reason }) : await cancelInvoiceAction({ id: c.id, reason });
    setBusy(false);
    if (!res.ok) return setProblem(errorMessage(res.error));
    toast.success(mode === "edit" ? t("amountSaved", { number: c.number }) : t("cancelledOne", { number: c.number }));
    setMode(null);
    setReason("");
    await onChanged();
  };

  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-mono text-xs">{c.number}</span>
          <span className="text-muted-foreground block truncate text-xs">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className={`mr-1 text-xs font-medium ${c.keep ? "text-status-approved" : c.has_money ? "text-status-pending" : "text-status-rejected"}`}>
            {c.keep ? t("keep") : c.has_money ? t("hasMoney") : t("remove")}
          </span>
          <Button asChild size="icon-sm" variant="ghost" title={t("open")} aria-label={t("open")}>
            <Link href={`/invoices/${c.id}`} target="_blank">
              <ExternalLink aria-hidden />
            </Link>
          </Button>
          {canEdit && (
            <Button type="button" size="icon-sm" variant="ghost" title={t("editAmount")} aria-label={t("editAmount")} onClick={() => setMode(mode === "edit" ? null : "edit")}>
              <PenLine aria-hidden />
            </Button>
          )}
          {canCancel && !c.has_money && (
            <Button type="button" size="icon-sm" variant="ghost" title={t("cancelOne")} aria-label={t("cancelOne")} onClick={() => setMode(mode === "cancel" ? null : "cancel")}>
              <XCircle aria-hidden />
            </Button>
          )}
        </span>
      </div>
      {mode && (
        <div className="mt-2 space-y-2">
          {problem && <p className="text-destructive text-xs">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            {mode === "edit" && (
              <Input
                aria-label={t("newAmount")}
                placeholder={t("newAmount")}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="h-8 w-32"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            )}
            <Input aria-label={t("reason")} placeholder={t("reason")} title={t("reasonHint")} className="h-8 min-w-40 flex-1" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setMode(null)}>
              {t("back")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "cancel" ? "destructive" : "default"}
              loading={busy}
              disabled={reason.trim().length < 5 || (mode === "edit" && !(Number(total) > 0))}
              onClick={save}
            >
              {mode === "edit" ? t("save") : t("cancelConfirm")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
