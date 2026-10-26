"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  deleteAccountAction,
  reverseJournalAction,
  saveAccountAction,
} from "@/app/[locale]/(staff)/accounting/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { Acct } from "./movement-forms";

const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
type GlType = (typeof TYPES)[number];

/** Add an account, or change one (`row`): names, type (only while unused), bank, on/off. */
export function AccountButton({ row, system }: { row?: Acct; system?: boolean }) {
  const t = useTranslations("accounting");
  const [open, setOpen] = useState(false);
  const start = () => ({
    code: row?.code ?? "",
    nameSo: row?.name_so ?? "",
    nameEn: row?.name_en ?? "",
    type: (row?.type ?? "expense") as GlType,
    isBank: row?.is_bank ?? false,
    active: row?.active ?? true,
  });
  const [v, setV] = useState(start);
  const openIt = () => {
    setV(start());
    setOpen(true);
  };
  const canBank = v.type === "asset" && /^11\d\d$/.test(v.code);
  return (
    <>
      {row ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-success"
          aria-label={t("edit")}
          title={t("edit")}
          onClick={openIt}
        >
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button size="sm" onClick={openIt}>
          <Plus aria-hidden />
          {t("accountForm.add")}
        </Button>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={row ? t("accountForm.editTitle", { code: row.code }) : t("accountForm.add")}
        description={t("accountForm.body")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        submit={() => saveAccountAction({ ...v, isBank: canBank && v.isBank })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="code"
              label={t("code")}
              hint={t("accountForm.codeHint")}
              error={fe("code")}
              required
            >
              <Input
                id="code"
                inputMode="numeric"
                maxLength={4}
                className="font-mono"
                disabled={!!row}
                value={v.code}
                onChange={(e) => setV({ ...v, code: e.target.value.replace(/\D/g, "") })}
              />
            </Field>
            <Field id="type" label={t("type")} error={fe("type")} required>
              <NativeSelect
                id="type"
                disabled={system}
                value={v.type}
                onChange={(e) => setV({ ...v, type: e.target.value as GlType })}
              >
                {TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`types.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="nameSo" label={t("accountForm.nameSo")} error={fe("nameSo")} required>
              <Input
                id="nameSo"
                value={v.nameSo}
                onChange={(e) => setV({ ...v, nameSo: e.target.value })}
              />
            </Field>
            <Field id="nameEn" label={t("accountForm.nameEn")} error={fe("nameEn")} required>
              <Input
                id="nameEn"
                value={v.nameEn}
                onChange={(e) => setV({ ...v, nameEn: e.target.value })}
              />
            </Field>
            <label
              className={`flex items-center gap-2 text-sm sm:col-span-2 ${canBank ? "" : "text-muted-foreground"}`}
            >
              <input
                type="checkbox"
                disabled={!canBank || row?.code === "1130"}
                checked={canBank && v.isBank}
                onChange={(e) => setV({ ...v, isBank: e.target.checked })}
              />
              {t("accountForm.isBank")}
            </label>
            {fe("isBank") && <p className="text-danger text-sm sm:col-span-2">{fe("isBank")}</p>}
            {!system && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={v.active}
                  onChange={(e) => setV({ ...v, active: e.target.checked })}
                />
                {t("accountForm.active")}
              </label>
            )}
          </div>
        )}
      </FormDialog>
    </>
  );
}

/** Delete an unused account; one with postings is switched off instead. */
export function AccountDelete({ row }: { row: Acct }) {
  const t = useTranslations("accounting");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-danger"
        aria-label={t("delete")}
        title={t("delete")}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden />
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("accountForm.deleteTitle", { code: row.code })}
        description={t("accountForm.deleteBody")}
        confirmLabel={t("delete")}
        destructive
        submit={async () => {
          const res = await deleteAccountAction({ code: row.code });
          if (res.ok)
            toast.success(res.data === "deleted" ? t("deleted") : t("accountForm.deactivated"));
          return res;
        }}
      />
    </>
  );
}

/** Reverse a manual journal entry with a reason. */
export function JournalReverseButton({ id, number }: { id: string; number: string }) {
  const t = useTranslations("accounting");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger h-7 px-2"
        onClick={() => setOpen(true)}
      >
        <Undo2 aria-hidden />
        {t("reverse")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setReason("");
        }}
        title={t("reverseTitle", { number })}
        description={t("reverseBody")}
        confirmLabel={t("reverse")}
        destructive
        successMessage={t("reversed")}
        submit={() => reverseJournalAction({ id, reason })}
      >
        {(fe) => (
          <Field id="reason" label={t("reason")} error={fe("reason")} required>
            <Textarea
              id="reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
