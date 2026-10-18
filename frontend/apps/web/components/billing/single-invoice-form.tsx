"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createInvoiceAction, findParcelAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

type Fee = { id: string; code: string; name_so: string; name_en: string; amount: number };
type Found = { id: string; pun: string | null; accountNo: string | null; status: string; district: { name_so: string; name_en: string } | null; owners: string[] };

/** Billing → Single invoice: one fee for one parcel (e.g. a certificate fee or a survey fee). */
export function SingleInvoiceForm({ fees }: { fees: Fee[] }) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [parcel, setParcel] = useState<Found | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [feeId, setFeeId] = useState(fees[0]?.id ?? "");
  const fee = fees.find((f) => f.id === feeId);
  const [amount, setAmount] = useState(fee ? String(fee.amount) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function find() {
    setNotFound(false);
    const r = await findParcelAction({ q });
    if (r.ok && r.data) setParcel(r.data);
    else {
      setParcel(null);
      setNotFound(true);
    }
  }

  async function create() {
    if (!parcel) return;
    setBusy(true);
    setError(null);
    const r = await createInvoiceAction({ parcelId: parcel.id, feeTypeId: feeId, amount: amount === "" ? null : amount, note });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(t("invoiceCreated", { number: r.data!.number }));
    router.push(`/invoices/${r.data!.id}`);
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <div className="flex items-start gap-2">
            <Field id="q" label={t("findParcel")} hint={t("findParcelHint")} className="min-w-0 flex-1">
              <Input className="font-mono uppercase" value={q} onChange={(e) => setQ(e.target.value)} placeholder="BN-HDN-T01-000001" />
            </Field>
            <Button type="submit" variant="outline" className="mt-[20px] h-10" disabled={q.trim().length < 3}>
              <Search aria-hidden />
              {t("find")}
            </Button>
          </div>
        </form>
        {notFound && <p className="text-sm text-status-rejected">{t("parcelNotFound")}</p>}
        {parcel && (
          <>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <Mono>{parcel.pun ?? "—"}</Mono> · <Mono>{parcel.accountNo ?? "—"}</Mono> · {parcel.district ? (locale === "so" ? parcel.district.name_so : parcel.district.name_en) : ""}
              <span className="block text-muted-foreground">{parcel.owners.join(", ") || t("noOwnerYet")}</span>
            </div>
            <FormError error={error && error.code !== "VALIDATION" ? error : null} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="fee" label={t("feeType")} error={vm(error?.fieldErrors?.feeTypeId?.[0])}>
                <NativeSelect
                  value={feeId}
                  onChange={(e) => {
                    setFeeId(e.target.value);
                    const f = fees.find((x) => x.id === e.target.value);
                    if (f) setAmount(String(f.amount));
                  }}
                >
                  {fees.map((f) => (
                    <option key={f.id} value={f.id}>
                      {locale === "so" ? f.name_so : f.name_en}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="amount" label={t("amountUsd")} error={vm(error?.fieldErrors?.amount?.[0])}>
                <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
            <Field id="note" label={t("noteOptional")}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button loading={busy} onClick={() => void create()} disabled={!feeId}>
                {t("createInvoice")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
