"use client";

import type { AppError } from "@dhulka/core/errors";
import { LAND_USES } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { MapPinPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { nearbyPinsAction } from "@/app/[locale]/(staff)/applications/actions";
import { getGeometryAction, locatePointAction, searchNeighbourhoodsAction } from "@/app/[locale]/(staff)/locations/actions";
import { addFieldLandAction } from "@/app/[locale]/(staff)/parcels/actions";
import { PinPicker, type Pin } from "@/components/applications/pin-picker";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

interface Props {
  districts: { id: string; name_so: string; name_en: string }[];
  grades: { code: string; name_so: string; name_en: string; active: boolean }[];
}

/** A surveyor in the field: where the house is, its size and number, and who owns it. Saved as partial land. */
export function FieldLandForm({ districts, grades }: Props) {
  const t = useTranslations("parcels.fieldLand");
  const ta = useTranslations("applications");
  const ts = useTranslations("stage");
  const tc = useTranslations("common");
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const [districtId, setDistrictId] = useState(districts.length === 1 ? districts[0]!.id : "");
  const [neighbourhood, setNeighbourhood] = useState<ComboOption | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinPlace, setPinPlace] = useState<string | null>(null);
  const [outline, setOutline] = useState<{ geometry: GeoJSON.Geometry; bbox: [number, number, number, number] } | null>(null);
  const [nearby, setNearby] = useState<string | null>(null);
  const [f, setF] = useState({ width: "", length: "", houseNo: "", grade: "", landUse: "residential", ownerName: "", ownerPhone: "", note: "" });
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);

  const searchNeighbourhoods = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchNeighbourhoodsAction({ q, districtId: districtId || null });
      if (!res.ok) return [];
      return res.data.map((n) => ({ value: n.id, label: locale === "so" ? n.name_so : n.name_en, hint: `${n.district_code}-${n.code}` }));
    },
    [districtId, locale],
  );

  useEffect(() => {
    if (!neighbourhood) return setOutline(null);
    void getGeometryAction({ level: "neighbourhoods", id: neighbourhood.value }).then((r) => setOutline(r.ok ? r.data : null));
  }, [neighbourhood]);

  // Dropping a pin fills in the neighbourhood and district, and warns about land already registered close by.
  const onPin = async (p: Pin) => {
    setPin(p);
    void nearbyPinsAction({ lon: p.lon, lat: p.lat, excludeId: null }).then((r) =>
      setNearby(
        r.ok && r.data.count > 0
          ? [...(r.data.parcels ?? []).map((x) => `${x.pun} (${x.metres} m)`), ...(r.data.applications ?? []).map((x) => `${x.number} (${x.metres} m)`)].join(", ")
          : null,
      ),
    );
    const res = await locatePointAction({ lon: p.lon, lat: p.lat });
    if (!res.ok) return;
    if (!res.data) return setPinPlace(ta("pinNoNeighbourhood"));
    const n = res.data;
    setPinPlace(`${locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en} · ${n.district_name_so}`);
    setDistrictId(n.district_id);
    setNeighbourhood({ value: n.neighbourhood_id, label: locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en, hint: `${n.district_code}-${n.neighbourhood_code}` });
  };

  const num = (x: string) => (x.trim() === "" ? Number.NaN : Number(x));
  const area = num(f.width) * num(f.length);

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await addFieldLandAction({
      districtId,
      neighbourhoodId: neighbourhood?.value ?? null,
      pinLon: pin?.lon as number,
      pinLat: pin?.lat as number,
      pinAccuracyM: pin?.accuracy ?? null,
      plotWidthM: num(f.width),
      plotLengthM: num(f.length),
      houseNo: f.houseNo,
      propertyType: f.grade,
      landUse: f.landUse,
      ownerName: f.ownerName,
      ownerPhone: f.ownerPhone,
      note: f.note,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    router.push("/parcels?stage=draft");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="districtId" label={ta("district")} error={fe("districtId")} required>
          <NativeSelect
            value={districtId}
            onChange={(e) => {
              setDistrictId(e.target.value);
              setNeighbourhood(null);
            }}
          >
            <option value="">{ta("choose")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="neighbourhoodId" label={ta("neighbourhood")} error={fe("neighbourhoodId")} hint={ta("neighbourhoodHint")}>
          <AsyncCombobox
            search={searchNeighbourhoods}
            value={neighbourhood ? [neighbourhood] : []}
            onChange={(o) => setNeighbourhood(o[0] ?? null)}
            disabled={!districtId}
            placeholder={ta("chooseNeighbourhood")}
            searchPlaceholder={tc("search")}
            emptyText={tc("noResults")}
          />
        </Field>
      </div>

      <Field id="pin" label={ta("pinLabel")} hint={pinPlace ?? t("pinHint")} error={fe("pin") ?? fe("pinLon")} required>
        <div>
          <PinPicker value={pin} onChange={(p) => void onPin(p)} outline={outline?.geometry ?? null} outlineBbox={outline?.bbox ?? null} />
          {nearby && (
            <p role="alert" className="mt-2 rounded-md border border-status-rejected/40 bg-status-rejected/10 px-3 py-2 text-xs">
              {t("nearby")} {nearby}
            </p>
          )}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="plotWidthM" label={ta("plotWidth")} error={fe("plotWidthM")} required>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={f.width} onChange={set("width")} />
        </Field>
        <Field id="plotLengthM" label={ta("plotLength")} error={fe("plotLengthM")} required>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={f.length} onChange={set("length")} />
        </Field>
        <Field id="area" label={t("area")}>
          <Input readOnly value={Number.isFinite(area) && area > 0 ? `${Math.round(area * 100) / 100} m²` : "—"} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="houseNo" label={ta("houseNo")} error={fe("houseNo")}>
          <Input value={f.houseNo} onChange={set("houseNo")} />
        </Field>
        <Field id="propertyType" label={t("grade")} error={fe("propertyType")}>
          <NativeSelect value={f.grade} onChange={set("grade")}>
            <option value="">{ta("choose")}</option>
            {grades
              .filter((g) => g.active)
              .map((g) => (
                <option key={g.code} value={g.code}>
                  {name(g)}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="landUse" label={ts("landUse")} error={fe("landUse")}>
          <NativeSelect value={f.landUse} onChange={set("landUse")}>
            {LAND_USES.map((u) => (
              <option key={u} value={u}>
                {ts(`landUses.${u}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ownerName" label={t("ownerName")} error={fe("ownerName")} required>
          <Input value={f.ownerName} onChange={set("ownerName")} autoComplete="off" />
        </Field>
        <Field id="ownerPhone" label={t("ownerPhone")} hint={t("ownerPhoneHint")} error={fe("ownerPhone")}>
          <Input type="tel" value={f.ownerPhone} onChange={set("ownerPhone")} placeholder="+252 61 123 4567" autoComplete="off" />
        </Field>
      </div>

      <Field id="note" label={t("note")} error={fe("note")}>
        <Textarea rows={2} value={f.note} onChange={set("note")} />
      </Field>

      <FormError error={error} />
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={saving}>
          <MapPinPlus aria-hidden />
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
