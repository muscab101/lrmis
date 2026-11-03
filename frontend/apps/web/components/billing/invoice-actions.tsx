"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Printer } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cancelInvoiceAction, createInvoiceAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";

interface Props {
  invoice: { id: string; paid: number; status: string; createdBy: string | null };
  me: string;
  can: { cancel: boolean };
}

export function InvoiceActions({ invoice, me, can }: Props) {
  const t = useTranslations("billing");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/invoices/${invoice.id}/print`} target="_blank">
          <Printer aria-hidden />
          {t("print")}
        </Link>
      </Button>
      {invoice.status !== "cancelled" && can.cancel && invoice.paid === 0 && invoice.createdBy !== me && (
        <Button size="sm" variant="destructive" onClick={() => setCancelling(true)}>
          {t("cancelInvoice")}
        </Button>
      )}

      <FormDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("cancelInvoiceTitle")}
        description={t("cancelInvoiceBody")}
        confirmLabel={t("cancelInvoice")}
        destructive
        successMessage={t("invoiceCancelled")}
        submit={() => cancelInvoiceAction({ id: invoice.id, reason })}
      >
        {(fe) => (
          <Field id="reason" label={t("reason")} error={fe("reason")} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </div>
  );
}

/** One-off fee (certificate, reprint…) on a parcel. */
export function NewFeeInvoiceButton({ parcelId, feeTypes }: { parcelId: string; feeTypes: { id: string; code: string; name_so: string; name_en: string; amount: number; interval: string }[] }) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const options = feeTypes.filter((f) => f.code !== "property_tax");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ feeTypeId: options[0]?.id ?? "", amount: "", note: "" });
  const chosen = options.find((f) => f.id === v.feeTypeId);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("newFeeInvoice")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("newFeeInvoice")}
        description={t("newFeeInvoiceBody")}
        confirmLabel={t("createInvoice")}
        submit={() => createInvoiceAction({ parcelId, feeTypeId: v.feeTypeId, amount: v.amount === "" ? null : v.amount, note: v.note })}
        onDone={(d) => router.push(`/invoices/${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <>
            <Field id="fee" label={t("feeType")} error={fe("feeTypeId")} required>
              <NativeSelect value={v.feeTypeId} onChange={(e) => setV({ ...v, feeTypeId: e.target.value })}>
                {options.map((f) => (
                  <option key={f.id} value={f.id}>
                    {locale === "so" ? f.name_so : f.name_en} · {format.number(Number(f.amount), { style: "currency", currency: "USD" })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="amount" label={t("amount")} hint={t("amountHint", { amount: chosen ? format.number(Number(chosen.amount), { style: "currency", currency: "USD" }) : "" })} error={fe("amount")}>
              <Input type="number" min={0} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </Field>
            <Field id="note" label={t("noteOptional")}>
              <Input value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
