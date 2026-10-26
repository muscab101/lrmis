"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { HandCoins, PackageCheck, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelHandoverAction,
  createHandoverAction,
  receiveHandoverAction,
} from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** The cashier hands a closed shift's counted cash to someone who will confirm it. */
export function HandoverButton({
  shift,
  receivers,
}: {
  shift: { id: string; number: string; counted_cash: number };
  receivers: { user_id: string; full_name: string }[];
}) {
  const t = useTranslations("collections");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    to: receivers[0]?.user_id ?? "",
    amount: shift.counted_cash.toFixed(2),
    note: "",
  });
  const differs = Math.abs(Number(v.amount || 0) - shift.counted_cash) > 0.004;
  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={receivers.length === 0}
        title={receivers.length === 0 ? t("handovers.nobody") : undefined}
      >
        <HandCoins aria-hidden />
        {t("handovers.handOver")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("handovers.handOverTitle", { number: shift.number })}
        description={t("handovers.handOverBody", {
          amount: format.number(shift.counted_cash, { style: "currency", currency: "USD" }),
        })}
        confirmLabel={t("handovers.handOver")}
        successMessage={t("handovers.handedOver")}
        submit={() =>
          createHandoverAction({
            shiftId: shift.id,
            to: v.to,
            amount: v.amount as unknown as number,
            note: v.note,
          })
        }
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="to" label={t("handovers.receiver")} error={fe("to")} required>
              <NativeSelect
                id="to"
                value={v.to}
                onChange={(e) => setV({ ...v, to: e.target.value })}
              >
                {receivers.map((r) => (
                  <option key={r.user_id} value={r.user_id}>
                    {r.full_name || "—"}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="amount" label={t("handovers.amount")} error={fe("amount")} required>
              <Input
                id="amount"
                type="number"
                min={0}
                step="0.01"
                value={v.amount}
                onChange={(e) => setV({ ...v, amount: e.target.value })}
              />
            </Field>
            <Field
              id="note"
              label={t("handovers.note")}
              hint={differs ? t("handovers.noteNeeded") : undefined}
              error={fe("note")}
              required={differs}
              className="sm:col-span-2"
            >
              <Textarea
                id="note"
                rows={2}
                value={v.note}
                onChange={(e) => setV({ ...v, note: e.target.value })}
              />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}

/** The receiver counts what they were given; a different amount needs a note. */
export function HandoverReceive({
  id,
  number,
  amount,
}: {
  id: string;
  number: string;
  amount: number;
}) {
  const t = useTranslations("collections");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ amount: amount.toFixed(2), note: "" });
  const differs = Math.abs(Number(v.amount || 0) - amount) > 0.004;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PackageCheck aria-hidden />
        {t("handovers.receive")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("handovers.receiveTitle", { number })}
        description={t("handovers.receiveBody", {
          amount: format.number(amount, { style: "currency", currency: "USD" }),
        })}
        confirmLabel={t("handovers.receive")}
        successMessage={t("handovers.received")}
        submit={() =>
          receiveHandoverAction({ id, amount: v.amount as unknown as number, note: v.note })
        }
      >
        {(fe) => (
          <div className="space-y-3">
            <Field id="amount" label={t("handovers.counted")} error={fe("amount")} required>
              <Input
                id="amount"
                type="number"
                min={0}
                step="0.01"
                value={v.amount}
                onChange={(e) => setV({ ...v, amount: e.target.value })}
              />
            </Field>
            {differs && <p className="text-warning text-sm">{t("handovers.willDispute")}</p>}
            <Field id="note" label={t("handovers.note")} error={fe("note")} required={differs}>
              <Textarea
                id="note"
                rows={2}
                value={v.note}
                onChange={(e) => setV({ ...v, note: e.target.value })}
              />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}

/** The cashier takes back a handover nobody has confirmed yet. */
export function HandoverCancel({ id, number }: { id: string; number: string }) {
  const t = useTranslations("collections");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden />
        {t("handovers.cancel")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("handovers.cancelTitle", { number })}
        description={t("handovers.cancelBody")}
        confirmLabel={t("handovers.cancel")}
        destructive
        successMessage={t("handovers.cancelled")}
        submit={() => cancelHandoverAction({ id })}
      />
    </>
  );
}
