"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Printer } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cancelInvoiceAction, createInvoiceAction, requestCreditNoteAction, requestPlanAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";

interface Props {
  invoice: { id: string; parcelId: string; balance: number; paid: number; status: string; createdBy: string | null };
  me: string;
  can: { credit: boolean; cancel: boolean; plan: boolean };
  /** Open invoices of the same parcel that a payment plan could cover. */
  openInvoices: { id: string; number: string; balance: number }[];
}

export function InvoiceActions({ invoice, me, can, openInvoices }: Props) {
  const t = useTranslations("billing");
  const format = useFormatter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const [dialog, setDialog] = useState<null | "credit" | "cancel" | "plan">(null);
  const [credit, setCredit] = useState({ amount: "", reason: "" });
  const [reason, setReason] = useState("");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [plan, setPlan] = useState({ invoiceIds: [invoice.id], instalments: "3", startDate: tomorrow, note: "" });
  const open = invoice.status === "issued" || invoice.status === "partially_paid";

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/invoices/${invoice.id}/print`} target="_blank">
          <Printer aria-hidden />
          {t("print")}
        </Link>
      </Button>
      {open && can.plan && invoice.balance > 0 && (
        <Button size="sm" variant="outline" onClick={() => setDialog("plan")}>
          {t("paymentPlan")}
        </Button>
      )}
      {open && can.credit && invoice.balance > 0 && (
        <Button size="sm" variant="outline" onClick={() => setDialog("credit")}>
          {t("creditNote")}
        </Button>
      )}
      {invoice.status !== "cancelled" && can.cancel && invoice.paid === 0 && invoice.createdBy !== me && (
        <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
          {t("cancelInvoice")}
        </Button>
      )}

      <FormDialog
        open={dialog === "credit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("creditNote")}
        description={t("creditNoteBody", { balance: usd(invoice.balance) })}
        confirmLabel={t("submitRequest")}
        successMessage={t("creditNoteRequested")}
        submit={() => requestCreditNoteAction({ invoiceId: invoice.id, ...credit })}
      >
        {(fe) => (
          <>
            <Field id="amount" label={t("amount")} error={fe("amount")} required>
              <Input type="number" min={0} step="0.01" value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value })} />
            </Field>
            <Field id="reason" label={t("reason")} error={fe("reason")} required>
              <Textarea rows={3} value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>

      <FormDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
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

      <FormDialog
        open={dialog === "plan"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("paymentPlan")}
        description={t("paymentPlanBody")}
        confirmLabel={t("submitRequest")}
        successMessage={t("planRequested")}
        submit={() => requestPlanAction({ parcelId: invoice.parcelId, ...plan })}
      >
        {(fe) => (
          <>
            <Field id="invoices" label={t("invoicesInPlan")} error={fe("invoiceIds")} required>
              <div className="space-y-1.5 rounded-md border p-3">
                {openInvoices.map((i) => (
                  <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        checked={plan.invoiceIds.includes(i.id)}
                        onCheckedChange={(c) => setPlan((p) => ({ ...p, invoiceIds: c === true ? [...p.invoiceIds, i.id] : p.invoiceIds.filter((x) => x !== i.id) }))}
                      />
                      <span className="font-mono">{i.number}</span>
                    </span>
                    <span className="tabular-nums">{usd(i.balance)}</span>
                  </label>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="instalments" label={t("instalments")} error={fe("instalments")} required>
                <Input type="number" min={2} max={36} value={plan.instalments} onChange={(e) => setPlan({ ...plan, instalments: e.target.value })} />
              </Field>
              <Field id="start" label={t("firstDue")} error={fe("startDate")} required>
                <Input type="date" min={tomorrow} value={plan.startDate} onChange={(e) => setPlan({ ...plan, startDate: e.target.value })} />
              </Field>
            </div>
            <Field id="note" label={t("noteOptional")}>
              <Input value={plan.note} maxLength={300} onChange={(e) => setPlan({ ...plan, note: e.target.value })} />
            </Field>
          </>
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
