"use client";

import type { AppError } from "@dhulka/core/errors";
import { ID_TYPES, partySchema, type PartyInput } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { duplicatePartiesAction, savePartyAction, updateMyPartyAction } from "@/app/[locale]/(staff)/applications/actions";
import { FormError } from "@/components/forms/form-error";
import { Link } from "@/i18n/navigation";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import type { PartyRow } from "@/lib/server/applications";

type Out = z.output<typeof partySchema>;

export function partyToInput(p: PartyRow | null, districtId?: string | null): PartyInput {
  return {
    kind: p?.kind ?? "person",
    fullName: p?.full_name ?? "",
    motherName: p?.mother_name ?? "",
    gender: p?.gender ?? "",
    dateOfBirth: p?.date_of_birth ?? "",
    nationality: p?.nationality ?? "SO",
    idType: (p?.id_type as PartyInput["idType"]) ?? "",
    idNumber: p?.id_number ?? "",
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    address: p?.address ?? "",
    orgRegistrationNo: p?.org_registration_no ?? "",
    nextOfKinName: p?.next_of_kin?.name ?? "",
    nextOfKinPhone: p?.next_of_kin?.phone ?? "",
    districtId: p?.district_id ?? districtId ?? "",
  };
}

interface Props {
  party: PartyRow | null;
  /** "staff" saves via save_party; "self" lets a citizen complete their own record. */
  mode?: "staff" | "self";
  districtId?: string | null;
  districts?: { id: string; name_so: string; name_en: string }[];
  onSaved: (id: string, values: PartyInput) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

/** Owner (person/organisation) form with a live duplicate check (§4.1). */
export function PartyForm({ party, mode = "staff", districtId, districts, onSaved, onCancel, submitLabel }: Props) {
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const [error, setError] = useState<AppError | null>(null);
  const [dupes, setDupes] = useState<Awaited<ReturnType<typeof duplicatePartiesAction>> | null>(null);
  const form = useForm<PartyInput, unknown, Out>({
    resolver: zodResolver(partySchema) as unknown as Resolver<PartyInput, unknown, Out>,
    defaultValues: partyToInput(party, districtId),
  });
  const e = form.formState.errors;
  const kind = form.watch("kind");
  const [fullName, motherName, idType, idNumber, phone] = form.watch(["fullName", "motherName", "idType", "idNumber", "phone"]);

  // Debounced duplicate check while typing.
  useEffect(() => {
    if ((fullName ?? "").trim().length < 3 && !(idNumber ?? "").trim() && !(phone ?? "").trim()) return setDupes(null);
    const h = setTimeout(async () => {
      const res = await duplicatePartiesAction({
        fullName: fullName ?? "",
        motherName: motherName ?? "",
        idType: idType ?? "",
        idNumber: idNumber ?? "",
        phone: phone ?? "",
        excludeId: party?.id ?? null,
      });
      setDupes(res);
    }, 500);
    return () => clearTimeout(h);
  }, [fullName, motherName, idType, idNumber, phone, party?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (mode === "self") {
      const res = await updateMyPartyAction(form.getValues());
      if (!res.ok) {
        applyFieldErrors(res.error, form.setError);
        return setError(res.error);
      }
      return onSaved(party?.id ?? "", form.getValues());
    }
    const res = await savePartyAction({ id: party?.id ?? null, input: form.getValues() });
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      return setError(res.error);
    }
    void values;
    onSaved(res.data!.id, form.getValues());
  });

  const dupeCount = dupes?.ok ? dupes.data.count : 0;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormError error={error && error.code !== "VALIDATION" ? error : null} />

      {mode === "staff" && (
        <div role="radiogroup" aria-label={t("kind")} className="grid grid-cols-2 gap-1 rounded-md border p-1 text-sm">
          {(["person", "organisation"] as const).map((k) => (
            <label key={k} className={`cursor-pointer rounded-sm px-3 py-1.5 text-center ${kind === k ? "bg-ink text-ink-foreground" : "hover:bg-muted"}`}>
              <input type="radio" value={k} className="sr-only" {...form.register("kind")} />
              {t(`kind_${k}`)}
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fullName" label={kind === "organisation" ? t("orgName") : t("fullName")} error={vm(e.fullName?.message)} required className="sm:col-span-2">
          <Input autoComplete="off" {...form.register("fullName")} />
        </Field>
        {kind === "person" && (
          <>
            <Field id="motherName" label={t("motherName")} hint={t("motherNameHint")} error={vm(e.motherName?.message)}>
              <Input autoComplete="off" {...form.register("motherName")} />
            </Field>
            <Field id="gender" label={t("gender")}>
              <NativeSelect {...form.register("gender")}>
                <option value="">—</option>
                <option value="male">{t("male")}</option>
                <option value="female">{t("female")}</option>
              </NativeSelect>
            </Field>
            <Field id="dateOfBirth" label={t("dateOfBirth")} error={vm(e.dateOfBirth?.message)}>
              <Input type="date" {...form.register("dateOfBirth")} />
            </Field>
            <Field id="nationality" label={t("nationality")} hint={t("nationalityHint")} error={vm(e.nationality?.message)}>
              <Input maxLength={2} className="uppercase" {...form.register("nationality")} />
            </Field>
          </>
        )}
        {kind === "organisation" && (
          <Field id="orgRegistrationNo" label={t("orgRegistrationNo")} error={vm(e.orgRegistrationNo?.message)}>
            <Input {...form.register("orgRegistrationNo")} />
          </Field>
        )}
        <Field id="idType" label={t("idType")}>
          <NativeSelect {...form.register("idType")}>
            <option value="">—</option>
            {ID_TYPES.map((it) => (
              <option key={it} value={it}>
                {t(`id_${it}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="idNumber" label={t("idNumber")} error={vm(e.idNumber?.message)}>
          <Input className="font-mono uppercase" {...form.register("idNumber")} />
        </Field>
        <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(e.phone?.message)}>
          <Input type="tel" inputMode="tel" placeholder="+252 61 …" disabled={mode === "self"} {...form.register("phone")} />
        </Field>
        <Field id="email" label={t("email")} error={vm(e.email?.message)}>
          <Input type="email" {...form.register("email")} />
        </Field>
        <Field id="address" label={t("address")} error={vm(e.address?.message)} className="sm:col-span-2">
          <Textarea rows={2} {...form.register("address")} />
        </Field>
        {mode === "staff" && kind === "person" && (
          <>
            <Field id="nextOfKinName" label={t("nextOfKinName")}>
              <Input {...form.register("nextOfKinName")} />
            </Field>
            <Field id="nextOfKinPhone" label={t("nextOfKinPhone")} error={vm(e.nextOfKinPhone?.message)}>
              <Input type="tel" {...form.register("nextOfKinPhone")} />
            </Field>
          </>
        )}
        {mode === "staff" && districts && (
          <Field id="districtId" label={t("district")} hint={t("districtHint")} className="sm:col-span-2">
            <NativeSelect {...form.register("districtId")}>
              <option value="">—</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name_so}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>

      {dupeCount > 0 && dupes?.ok && (
        <Alert tone="warning" title={t("dupesTitle", { count: dupeCount })}>
          {dupes.data.matches ? (
            <ul className="mt-1 space-y-1">
              {dupes.data.matches.map((m) => (
                <li key={m.id}>
                  <Link href={`/owners/${m.id}`} className="font-medium underline" target="_blank">
                    {m.full_name}
                  </Link>
                  {m.mother_name ? ` · ${m.mother_name}` : ""} — {m.reasons.map((r) => t(`reason_${r}`)).join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("dupesCitizen")}</p>
          )}
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tc("cancel")}
          </Button>
        )}
        <Button type="submit" loading={form.formState.isSubmitting}>
          {submitLabel ?? (party ? tc("saveChanges") : t("create"))}
        </Button>
      </div>
    </form>
  );
}
