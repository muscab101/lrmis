"use client";

import { countryOptions, NO_ID_NUMBER } from "@dhulka/core/countries";
import { capitalizeName, ID_TYPES, type PartyInput } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listOwnerTypesAction, type OwnerTypeOption } from "@/app/[locale]/(staff)/owners/actions";

/**
 * Every owner field as plain inputs, for forms that save the owner together with something else (the parcel edit).
 * Errors come in under "owner.<field>".
 */
export function OwnerFields({
  value,
  onChange,
  error,
}: {
  value: PartyInput;
  onChange: (v: PartyInput) => void;
  error: (key: string) => string | undefined;
}) {
  const t = useTranslations("owners");
  const locale = useLocale();
  const [types, setTypes] = useState<OwnerTypeOption[]>([]);
  useEffect(() => {
    void listOwnerTypesAction({}).then((r) => r.ok && setTypes(r.data ?? []));
  }, []);
  // Country names differ between the server and the browser: the full list fills in once in the browser.
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const set = <K extends keyof PartyInput>(k: K, v: PartyInput[K]) =>
    onChange({ ...value, [k]: v });
  const name = (k: "fullName" | "motherName" | "nextOfKinName") => ({
    value: (value[k] as string) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, capitalizeName(e.target.value)),
    autoComplete: "off",
  });
  const person = (value.kind ?? "person") === "person";
  const fe = (k: string) => error(`owner.${k}`);

  return (
    <fieldset className="space-y-3 rounded-md border p-3 sm:col-span-2">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <UserRound className="size-4" aria-hidden />
        {t("ownerDetails")}
      </legend>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Field id="o-type" label={t("ownerType")} error={fe("ownerTypeId")}>
          <NativeSelect
            value={value.ownerTypeId ?? ""}
            onChange={(e) => set("ownerTypeId", e.target.value)}
          >
            <option value="">—</option>
            {types
              .filter((o) => o.active || o.id === value.ownerTypeId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {locale === "so" ? o.name_so : o.name_en}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="o-kind" label={t("kind")}>
          <NativeSelect
            value={value.kind ?? "person"}
            onChange={(e) => set("kind", e.target.value as PartyInput["kind"])}
          >
            <option value="person">{t("kind_person")}</option>
            <option value="organisation">{t("kind_organisation")}</option>
          </NativeSelect>
        </Field>
        <Field
          id="o-name"
          label={person ? t("fullName") : t("orgName")}
          error={fe("fullName")}
          required
          className="sm:col-span-2"
        >
          <Input {...name("fullName")} />
        </Field>
        <Field id="o-phone" label={t("phone")} hint={t("phoneHint")} error={fe("phone")}>
          <Input
            type="tel"
            inputMode="tel"
            value={value.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+252 61 123 4567"
          />
        </Field>
        <Field id="o-email" label={t("email")} error={fe("email")}>
          <Input
            type="email"
            value={value.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        {person ? (
          <>
            <Field id="o-mother" label={t("motherName")} error={fe("motherName")}>
              <Input {...name("motherName")} />
            </Field>
            <Field id="o-gender" label={t("gender")} error={fe("gender")}>
              <NativeSelect
                value={value.gender ?? ""}
                onChange={(e) => set("gender", e.target.value as PartyInput["gender"])}
              >
                <option value="">—</option>
                <option value="male">{t("male")}</option>
                <option value="female">{t("female")}</option>
              </NativeSelect>
            </Field>
            <Field id="o-dob" label={t("dateOfBirth")} error={fe("dateOfBirth")}>
              <Input
                type="date"
                min="1900-01-01"
                max={new Date().toISOString().slice(0, 10)}
                value={value.dateOfBirth ?? ""}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </Field>
            <Field id="o-nat" label={t("nationality")} error={fe("nationality")}>
              <NativeSelect
                value={value.nationality ?? "SO"}
                onChange={(e) => set("nationality", e.target.value)}
              >
                {countries
                  .filter((c) => inBrowser || c.code === (value.nationality ?? "SO"))
                  .map((c) => (
                    <option key={c.code} value={c.code} suppressHydrationWarning>
                      {c.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          </>
        ) : (
          <Field
            id="o-org"
            label={t("orgRegistrationNo")}
            error={fe("orgRegistrationNo")}
            className="sm:col-span-2"
          >
            <Input
              value={value.orgRegistrationNo ?? ""}
              onChange={(e) => set("orgRegistrationNo", e.target.value)}
            />
          </Field>
        )}
        <Field id="o-idtype" label={t("idType")} error={fe("idType")}>
          <NativeSelect
            value={value.idType ?? ""}
            onChange={(e) => set("idType", e.target.value as PartyInput["idType"])}
          >
            <option value="">—</option>
            {ID_TYPES.map((it) => (
              <option key={it} value={it}>
                {t(`id_${it}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="o-idno"
          label={t("idNumber")}
          hint={person ? t("noIdHint") : undefined}
          error={fe("idNumber")}
        >
          <div className="flex gap-2">
            <Input
              className="font-mono uppercase"
              value={value.idNumber ?? ""}
              onChange={(e) => set("idNumber", e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              title={t("noIdHint")}
              onClick={() =>
                onChange({ ...value, idNumber: NO_ID_NUMBER, idType: value.idType || "other" })
              }
            >
              N/A
            </Button>
          </div>
        </Field>
        <Field id="o-address" label={t("address")} error={fe("address")} className="sm:col-span-2">
          <Textarea
            rows={2}
            value={value.address ?? ""}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        {person && (
          <>
            <Field id="o-kin" label={t("nextOfKinName")} error={fe("nextOfKinName")}>
              <Input {...name("nextOfKinName")} />
            </Field>
            <Field id="o-kinphone" label={t("nextOfKinPhone")} error={fe("nextOfKinPhone")}>
              <Input
                type="tel"
                inputMode="tel"
                value={value.nextOfKinPhone ?? ""}
                onChange={(e) => set("nextOfKinPhone", e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </fieldset>
  );
}
