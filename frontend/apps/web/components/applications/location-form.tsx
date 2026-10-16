"use client";

import type { AppError } from "@dhulka/core/errors";
import { APPLICATION_TYPES, type ApplicationType } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { createApplicationAction, updateApplicationAction } from "@/app/[locale]/(staff)/applications/actions";
import { getGeometryAction, locatePointAction, searchNeighbourhoodsAction } from "@/app/[locale]/(staff)/locations/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import { PinPicker, type Pin } from "./pin-picker";

export interface LocationValues {
  type: ApplicationType;
  channel: "portal" | "office" | "field";
  districtId: string;
  neighbourhood: ComboOption | null;
  pin: Pin | null;
  addressNote: string;
  plotNo: string;
  oldDeedNo: string;
  govtFileNo: string;
}

interface Props {
  mode: "create" | "edit";
  applicationId?: string;
  initial: LocationValues;
  districts: { id: string; code: string; name_so: string; name_en: string }[];
  isStaff: boolean;
  basePath: string;
  readOnly?: boolean;
  onSaved?: () => void;
}

/** Step 1 — what and where: type, district, neighbourhood, map pin, plot / deed numbers. */
export function LocationForm({ mode, applicationId, initial, districts, isStaff, basePath, readOnly = false, onSaved }: Props) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const [v, setV] = useState<LocationValues>(initial);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const [outline, setOutline] = useState<{ geometry: GeoJSON.Geometry; bbox: [number, number, number, number] } | null>(null);
  const [pinPlace, setPinPlace] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const set = <K extends keyof LocationValues>(k: K, val: LocationValues[K]) => setV((prev) => ({ ...prev, [k]: val }));

  const searchNeighbourhoods = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchNeighbourhoodsAction({ q, districtId: v.districtId || null });
      if (!res.ok) return [];
      return res.data.map((n) => ({ value: n.id, label: locale === "so" ? n.name_so : n.name_en, hint: `${n.district_code}-${n.code}` }));
    },
    [v.districtId, locale],
  );

  // Show the chosen neighbourhood's outline on the map.
  useEffect(() => {
    if (!v.neighbourhood) return setOutline(null);
    void getGeometryAction({ level: "neighbourhoods", id: v.neighbourhood.value }).then((r) => setOutline(r.ok ? r.data : null));
  }, [v.neighbourhood]);

  // Dropping a pin finds the neighbourhood (and district) it falls in.
  const onPin = useCallback(
    async (pin: Pin) => {
      setV((prev) => ({ ...prev, pin }));
      const res = await locatePointAction({ lon: pin.lon, lat: pin.lat });
      if (!res.ok) return;
      if (!res.data) return setPinPlace(t("pinNoNeighbourhood"));
      const n = res.data;
      setPinPlace(`${locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en} · ${n.district_name_so}`);
      setV((prev) => ({
        ...prev,
        districtId: n.district_id,
        neighbourhood: { value: n.neighbourhood_id, label: locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en, hint: `${n.district_code}-${n.neighbourhood_code}` },
      }));
    },
    [locale, t],
  );

  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      type: v.type,
      channel: v.channel,
      districtId: v.districtId,
      neighbourhoodId: v.neighbourhood?.value ?? "",
      pinLon: v.pin?.lon ?? null,
      pinLat: v.pin?.lat ?? null,
      pinAccuracyM: v.pin?.accuracy ?? null,
      addressNote: v.addressNote,
      plotNo: v.plotNo,
      oldDeedNo: v.oldDeedNo,
      govtFileNo: v.govtFileNo,
    };
    if (mode === "create") {
      const res = await createApplicationAction({ ...payload, idempotencyKey });
      setSaving(false);
      if (!res.ok) return setError(res.error);
      toast.success(t("draftCreated", { number: res.data!.number }));
      router.push(`${basePath}/${res.data!.id}`);
      return;
    }
    const res = await updateApplicationAction({ ...payload, applicationId: applicationId! });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(tc("saved"));
    onSaved?.();
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <FormError error={error && error.code !== "VALIDATION" ? error : null} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="type" label={t("type")} required>
          <NativeSelect value={v.type} disabled={readOnly || mode === "edit"} onChange={(e) => set("type", e.target.value as ApplicationType)}>
            {APPLICATION_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`types.${ty}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {isStaff && (
          <Field id="channel" label={t("channel")}>
            <NativeSelect value={v.channel} disabled={readOnly || mode === "edit"} onChange={(e) => set("channel", e.target.value as LocationValues["channel"])}>
              <option value="office">{t("channels.office")}</option>
              <option value="field">{t("channels.field")}</option>
            </NativeSelect>
          </Field>
        )}
        <Field id="districtId" label={t("district")} error={fe("districtId")} required>
          <NativeSelect
            value={v.districtId}
            disabled={readOnly}
            onChange={(e) => setV((prev) => ({ ...prev, districtId: e.target.value, neighbourhood: null }))}
          >
            <option value="">{t("choose")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {locale === "so" ? d.name_so : d.name_en}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="neighbourhoodId" label={t("neighbourhood")} error={fe("neighbourhoodId")} hint={t("neighbourhoodHint")}>
          <AsyncCombobox
            search={searchNeighbourhoods}
            value={v.neighbourhood ? [v.neighbourhood] : []}
            onChange={(o) => set("neighbourhood", o[0] ?? null)}
            disabled={readOnly || !v.districtId}
            placeholder={t("chooseNeighbourhood")}
            searchPlaceholder={tc("search")}
            emptyText={tc("noResults")}
          />
        </Field>
      </div>

      <Field id="pin" label={t("pinLabel")} hint={pinPlace ?? t("pinHint")} error={fe("pin")} required={v.type === "new_registration"}>
        <div>
          <PinPicker value={v.pin} onChange={(p) => void onPin(p)} disabled={readOnly} outline={outline?.geometry ?? null} outlineBbox={outline?.bbox ?? null} />
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="plotNo" label={t("plotNo")} error={fe("plotNo")}>
          <Input value={v.plotNo} disabled={readOnly} onChange={(e) => set("plotNo", e.target.value)} />
        </Field>
        <Field id="oldDeedNo" label={t("oldDeedNo")} error={fe("oldDeedNo")}>
          <Input value={v.oldDeedNo} disabled={readOnly} onChange={(e) => set("oldDeedNo", e.target.value)} />
        </Field>
        <Field id="govtFileNo" label={t("govtFileNo")} error={fe("govtFileNo")}>
          <Input value={v.govtFileNo} disabled={readOnly} onChange={(e) => set("govtFileNo", e.target.value)} />
        </Field>
      </div>
      <Field id="addressNote" label={t("addressNote")} hint={t("addressNoteHint")} error={fe("addressNote")}>
        <Textarea rows={2} value={v.addressNote} disabled={readOnly} onChange={(e) => set("addressNote", e.target.value)} />
      </Field>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          {mode === "create" && (
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {tc("cancel")}
            </Button>
          )}
          <Button type="button" loading={saving} disabled={!v.districtId} onClick={() => void save()}>
            {mode === "create" ? t("startApplication") : tc("saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}
