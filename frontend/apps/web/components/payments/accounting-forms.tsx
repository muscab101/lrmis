"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { manualJournalAction, setFxRateAction, setPeriodAction } from "@/app/[locale]/(staff)/payments/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

export function FxRateButton() {
  const t = useTranslations("accounting");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ currency: "SOS" as const, date: new Date().toISOString().slice(0, 10), rate: "" });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("addRate")}
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={t("addRate")} description={t("addRateBody")} confirmLabel={t("save")} successMessage={t("saved")} submit={() => setFxRateAction(v)}>
        {(fe) => (
          <div className="grid grid-cols-2 gap-3">
            <Field id="date" label={t("date")} error={fe("date")} required>
              <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
            </Field>
            <Field id="rate" label={t("sosPerUsd")} error={fe("rate")} required>
              <Input type="number" min={0} step="0.01" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}

export function PeriodButton({ year, month, locked }: { year: number; month: number; locked: boolean }) {
  const t = useTranslations("accounting");
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant={locked ? "outline" : "destructive"}
      onClick={async () => {
        const res = await setPeriodAction({ year, month, lock: !locked });
        if (res.ok) {
          toast.success(locked ? t("unlocked") : t("locked"));
          router.refresh();
        } else toast.error(t("actionFailed"));
      }}
    >
      {locked ? t("unlock") : t("lock")}
    </Button>
  );
}

export function ManualJournalButton({ accounts }: { accounts: { code: string; name_so: string; name_en: string }[] }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const blank = { account: accounts[0]?.code ?? "", debit: "", credit: "" };
  const [lines, setLines] = useState([blank, { ...blank, account: accounts[1]?.code ?? "" }]);
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("manualJournal")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("manualJournal")}
        description={t("manualJournalBody")}
        confirmLabel={t("post")}
        successMessage={t("posted")}
        submit={() => manualJournalAction({ date, memo, lines: lines.map((l) => ({ account: l.account, debit: l.debit || 0, credit: l.credit || 0 })) })}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-[10rem_1fr] gap-3">
              <Field id="date" label={t("date")} error={fe("date")} required>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="memo" label={t("memo")} error={fe("memo")} required>
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
              </Field>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] gap-2">
                  <NativeSelect value={l.account} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} aria-label={t("account")}>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} · {locale === "so" ? a.name_so : a.name_en}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input type="number" min={0} step="0.01" placeholder={t("debit")} aria-label={t("debit")} value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: "" } : x)))} />
                  <Input type="number" min={0} step="0.01" placeholder={t("credit")} aria-label={t("credit")} value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: "" } : x)))} />
                  <Button size="icon-sm" variant="ghost" aria-label={t("removeLine")} disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <Button size="sm" variant="ghost" onClick={() => setLines([...lines, blank])}>
                  <Plus aria-hidden />
                  {t("addLine")}
                </Button>
                <span className={dr === cr && dr > 0 ? "text-status-approved" : "text-status-rejected"}>{t("totals", { dr: dr.toFixed(2), cr: cr.toFixed(2) })}</span>
              </div>
              {fe("lines") && <p className="text-sm text-status-rejected">{fe("lines")}</p>}
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}
