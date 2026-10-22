"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";
import { setFeeAmountAction } from "./actions";

/** The edit key of a fee row: its amount (USD) and whether it's charged. */
export function FeeActions({ fee }: { fee: { id: string; name: string; amount: number; active: boolean } }) {
  const t = useTranslations("admin.fees");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ amount: String(fee.amount), active: fee.active });

  return (
    <>
      <div className="flex justify-end">
        <Tooltip content={tc("edit")}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-success"
            aria-label={tc("edit")}
            onClick={() => {
              setV({ amount: String(fee.amount), active: fee.active });
              setOpen(true);
            }}
          >
            <Pencil aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("editTitle", { name: fee.name })}
        description={t("formBody")}
        confirmLabel={tc("save")}
        successMessage={tc("saved")}
        submit={() => setFeeAmountAction({ id: fee.id, amount: Number(v.amount || 0), active: v.active })}
      >
        {(fe) => (
          <div className="grid gap-3">
            <Field id={`fee-amount-${fee.id}`} label={t("amount")} hint={t("amountHint")} error={fe("amount")}>
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c === true })} />
              {t("activeLabel")}
            </label>
          </div>
        )}
      </FormDialog>
    </>
  );
}
