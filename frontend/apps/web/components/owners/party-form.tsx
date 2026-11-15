"use client";

import { countryOptions, dialCode, NO_ID_NUMBER } from "@dhulka/core/countries";
import type { AppError } from "@dhulka/core/errors";
import { capitalizeName, ID_TYPES, ownerSchema, partySchema, type PartyInput } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { savePartyAction, updateMyPartyAction } from "@/app/[locale]/(staff)/applications/actions";
import { listOwnerTypesAction, type OwnerTypeOption } from "@/app/[locale]/(staff)/owners/actions";
import { FormError } from "@/components/forms/form-error";
import { OwnerMatchNotice } from "@/components/owners/owner-match";
import type { OwnerMatch } from "@/app/[locale]/(staff)/owners/actions";
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
    // A saved person without an ID document shows "N/A" (staff typed N/A; it's stored as no ID).
    idType: (p?.id_type as PartyInput["idType"]) ?? (p && p.kind === "person" ? "other" : ""),
    idNumber: p?.id_number ?? (p && p.kind === "person" ? NO_ID_NUMBER : ""),
    phone: p?.phone ?? "",
    email: p?.email ?? "",
    address: p?.address ?? "",
    orgRegistrationNo: p?.org_registration_no ?? "",
    nextOfKinName: p?.next_of_kin?.name ?? "",
    nextOfKinPhone: p?.next_of_kin?.phone ?? "",
    districtId: p?.district_id ?? districtId ?? "",
    ownerTypeId: p?.owner_type_id ?? "",
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
  /** New owner only: an owner with the same name and phone is already on the register; use them instead. */
  onMerge?: (match: OwnerMatch) => void;
}

/** Owner (person/organisation) form. A clashing ID number is refused when saving. */
export function PartyForm({ party, mode = "staff", districtId, districts, onSaved, onCancel, submitLabel, onMerge }: Props) {
  const locale = useLocale();
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const [error, setError] = useState<AppError | null>(null);
  const [ownerTypes, setOwnerTypes] = useState<OwnerTypeOption[]>([]);
  useEffect(() => {
    if (mode !== "staff") return;
    void listOwnerTypesAction({}).then((res) => {
      if (res.ok) setOwnerTypes(res.data ?? []);
    });
  }, [mode]);
  const form = useForm<PartyInput, unknown, Out>({
    // Staff record a full owner (every field, the ID included); citizens keep the lighter profile form.
    resolver: zodResolver(mode === "staff" ? ownerSchema : partySchema) as unknown as Resolver<PartyInput, unknown, Out>,
    defaultValues: (() => {
      const v = partyToInput(party, districtId);
      // A new owner's phone starts with their country's dialling code.
      return party ? v : { ...v, phone: v.phone || dialCode(v.nationality) };
    })(),
  });
  // Country names differ between the server and the browser, so the full list only fills in once in the browser.
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const chosenCountry = form.getValues("nationality");
  const nationalityField = form.register("nationality");
  // Names start each word with a capital as they are typed ("mohamed al haji" → "Mohamed Al Haji").
  const nameField = (name: "fullName" | "motherName" | "nextOfKinName") => {
    const field = form.register(name);
    return {
      ...field,
      onChange: (ev: React.ChangeEvent<HTMLInputElement>) => {
        const el = ev.target;
        const caret = el.selectionStart;
        el.value = capitalizeName(el.value);
        if (caret !== null) el.setSelectionRange(caret, caret);
        return field.onChange(ev);
      },
    };
  };
  const e = form.formState.errors;
  const kind = form.watch("kind");
  const ownerTypeId = form.watch("ownerTypeId");

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

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormError error={error && error.code !== "VALIDATION" ? error : null} />

      {mode === "staff" && (
        <div role="radiogroup" aria-label={t("kind")} className="grid grid-cols-2 gap-1 rounded-md border p-1 text-sm">
          {(["person", "organisation"] as const).map((k) => (
            <label key={k} className={`cursor-pointer rounded-sm px-3 py-1.5 text-center ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              <input type="radio" value={k} className="sr-only" {...form.register("kind")} />
              {t(`kind_${k}`)}
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "staff" && (
          <Field id="ownerTypeId" label={t("ownerType")} error={vm(e.ownerTypeId?.message)} required className="sm:col-span-2">
            {/* The choices arrive after the form opens, so the value is set on the box directly. */}
            <NativeSelect {...form.register("ownerTypeId")} value={ownerTypeId ?? ""}>
              <option value="">—</option>
              {ownerTypes
                .filter((o) => o.active || o.id === party?.owner_type_id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {locale === "so" ? o.name_so : o.name_en}
                  </option>
                ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="fullName" label={kind === "organisation" ? t("orgName") : t("fullName")} error={vm(e.fullName?.message)} required className="sm:col-span-2">
          <Input autoComplete="off" {...nameField("fullName")} />
        </Field>
        {kind === "person" && (
          <>
            <Field id="motherName" label={t("motherName")} hint={t("motherNameHint")} error={vm(e.motherName?.message)} required={mode === "staff"}>
              <Input autoComplete="off" {...nameField("motherName")} />
            </Field>
            <Field id="gender" label={t("gender")} error={vm(e.gender?.message)} required={mode === "staff"}>
              <NativeSelect {...form.register("gender")}>
                <option value="">—</option>
                <option value="male">{t("male")}</option>
                <option value="female">{t("female")}</option>
              </NativeSelect>
            </Field>
            <Field id="dateOfBirth" label={t("dateOfBirth")} error={vm(e.dateOfBirth?.message)} required={mode === "staff"}>
              <Input type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} {...form.register("dateOfBirth")} />
            </Field>
            <Field id="nationality" label={t("nationality")} error={vm(e.nationality?.message)} required={mode === "staff"}>
              <NativeSelect
                {...nationalityField}
                onChange={(ev) => {
                  void nationalityField.onChange(ev);
                  // The phone follows the country: swap the dialling code while only the code (or nothing) is typed.
                  const before = (form.getValues("phone") ?? "").replace(/\s/g, "");
                  const next = dialCode(ev.target.value);
                  if (next && (!before || /^\+\d{1,4}$/.test(before))) form.setValue("phone", next, { shouldDirty: true });
                }}
              >
                {countries
                  .filter((c) => inBrowser || c.code === chosenCountry)
                  .map((c) => (
                    <option key={c.code} value={c.code} suppressHydrationWarning>
                      {c.name} ({c.dial})
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          </>
        )}
        {kind === "organisation" && (
          <Field id="orgRegistrationNo" label={t("orgRegistrationNo")} error={vm(e.orgRegistrationNo?.message)} required={mode === "staff"}>
            <Input {...form.register("orgRegistrationNo")} />
          </Field>
        )}
        <Field id="idType" label={t("idType")} error={vm(e.idType?.message)} required={mode === "staff" && kind === "person"}>
          <NativeSelect {...form.register("idType")}>
            <option value="">—</option>
            {ID_TYPES.map((it) => (
              <option key={it} value={it}>
                {t(`id_${it}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="idNumber" label={t("idNumber")} hint={mode === "staff" && kind === "person" ? t("noIdHint") : undefined} error={vm(e.idNumber?.message)} required={mode === "staff" && kind === "person"}>
          <div className="flex gap-2">
            <Input className="font-mono uppercase" {...form.register("idNumber")} />
            {/* No ID document: N/A, accepted for anyone and never a duplicate. */}
            <Button
              type="button"
              variant="outline"
              title={t("noIdHint")}
              onClick={() => {
                form.setValue("idNumber", NO_ID_NUMBER, { shouldDirty: true, shouldValidate: true });
                if (!form.getValues("idType")) form.setValue("idType", "other", { shouldDirty: true, shouldValidate: true });
              }}
            >
              N/A
            </Button>
          </div>
        </Field>
        <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(e.phone?.message)} required={mode === "staff"}>
          <Input type="tel" inputMode="tel" placeholder={`${dialCode(form.watch("nationality")) || "+252"} …`} disabled={mode === "self"} {...form.register("phone")} />
        </Field>
        {!party && onMerge && (
          <div className="sm:col-span-2">
            <OwnerMatchNotice name={form.watch("fullName") ?? ""} phone={form.watch("phone") ?? ""} onMerge={onMerge} />
          </div>
        )}
        <Field id="email" label={t("email")} error={vm(e.email?.message)} required={mode === "staff"}>
          <Input type="email" {...form.register("email")} />
        </Field>
        <Field id="address" label={t("address")} error={vm(e.address?.message)} className="sm:col-span-2">
          <Textarea rows={2} {...form.register("address")} />
        </Field>
        {mode === "staff" && kind === "person" && (
          <>
            <Field id="nextOfKinName" label={t("nextOfKinName")} error={vm(e.nextOfKinName?.message)} required>
              <Input {...nameField("nextOfKinName")} />
            </Field>
            <Field id="nextOfKinPhone" label={t("nextOfKinPhone")} error={vm(e.nextOfKinPhone?.message)} required>
              <Input type="tel" {...form.register("nextOfKinPhone")} />
            </Field>
          </>
        )}
        {mode === "staff" && districts && (
          <Field id="districtId" label={t("district")} hint={t("districtHint")} error={vm(e.districtId?.message)} className="sm:col-span-2" required>
            <NativeSelect {...form.register("districtId")}>
              <option value="">—</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {locale === "so" ? d.name_so : d.name_en}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>

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
