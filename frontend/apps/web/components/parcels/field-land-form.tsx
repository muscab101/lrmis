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
import {
  getGeometryAction,
  locatePointAction,
  searchNeighbourhoodsAction,
} from "@/app/[locale]/(staff)/locations/actions";
import {
  addFieldLandAction,
  houseNumberChoicesAction,
  neighbourhoodViewAction,
} from "@/app/[locale]/(staff)/parcels/actions";
import { PinPicker, type Pin } from "@/components/applications/pin-picker";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { isApartmentType } from "@/lib/apartment";
import { useValidationMessage } from "@/lib/client/errors";

interface Props {
  districts: { id: string; name_so: string; name_en: string }[];
  grades: { code: string; name_so: string; name_en: string; active: boolean }[];
  /** Opened from a survey zone: its neighbourhood. */
  start?: {
    id: string;
    district_id: string;
    code: string;
    name_so: string;
    name_en: string;
  } | null;
  /** Where to go after saving (the survey zone it came from); else Parcels → Partial registration. */
  returnTo?: string;
  /** The owner just entered with the full owner form: the land is theirs. */
  owner?: { id: string; full_name: string; phone: string | null } | null;
}

/** A surveyor in the field: where the house is, its size and number, and who owns it. Saved as partial land. */
export function FieldLandForm({ districts, grades, start = null, returnTo, owner = null }: Props) {
  const t = useTranslations("parcels.fieldLand");
  const ta = useTranslations("applications");
  const ts = useTranslations("stage");
  const tc = useTranslations("common");
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const [districtId, setDistrictId] = useState(
    start?.district_id ?? (districts.length === 1 ? districts[0]!.id : ""),
  );
  const [neighbourhood, setNeighbourhood] = useState<ComboOption | null>(
    start
      ? {
          value: start.id,
          label: locale === "so" ? start.name_so : start.name_en,
          hint: start.code,
        }
      : null,
  );
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinPlace, setPinPlace] = useState<string | null>(null);
  const [outline, setOutline] = useState<{
    geometry: GeoJSON.Geometry;
    bbox: [number, number, number, number];
  } | null>(null);
  const [nearby, setNearby] = useState<string | null>(null);
  const [f, setF] = useState({
    width: "",
    length: "",
    houseNo: "",
    grade: "",
    landUse: "residential",
    ownerName: "",
    ownerPhone: "",
    note: "",
  });
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const name = (o: { name_so: string; name_en: string }) =>
    locale === "so" ? o.name_so : o.name_en;

  const searchNeighbourhoods = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchNeighbourhoodsAction({ q, districtId: districtId || null });
      if (!res.ok) return [];
      return res.data.map((n) => ({
        value: n.id,
        label: locale === "so" ? n.name_so : n.name_en,
        hint: `${n.district_code}-${n.code}`,
      }));
    },
    [districtId, locale],
  );

  // The map goes to the neighbourhood: its boundary when drawn; otherwise its district's boundary, zoomed in on the
  // neighbourhood's point when it has one. With only a district chosen, the district.
  useEffect(() => {
    let live = true;
    if (neighbourhood) {
      void neighbourhoodViewAction({ id: neighbourhood.value }).then((r) => {
        if (!live) return;
        const v = r.ok ? r.data : null;
        if (v?.neighbourhood) return setOutline(v.neighbourhood);
        const shape = v?.district ?? null;
        if (v?.point) {
          const [lon, lat] = v.point;
          return setOutline({
            geometry: shape?.geometry ?? { type: "Point", coordinates: v.point },
            bbox: [lon - 0.004, lat - 0.003, lon + 0.004, lat + 0.003],
          });
        }
        setOutline(shape);
      });
    } else if (districtId) {
      void getGeometryAction({ level: "districts", id: districtId }).then(
        (r) => live && setOutline(r.ok ? r.data : null),
      );
    } else setOutline(null);
    return () => {
      live = false;
    };
  }, [neighbourhood, districtId]);

  // Opened for a survey zone: the surveyor records land in that neighbourhood only.
  const locked = !!start;

  // House No: 01 up to the neighbourhood's capacity, without the numbers other land there already has
  // (flats in one block may share a number).
  const [houseChoices, setHouseChoices] = useState<{
    code: string | null;
    capacity: number;
    taken: { house_no: string; apartment: boolean }[];
  } | null>(null);
  useEffect(() => {
    setHouseChoices(null);
    if (!neighbourhood) return;
    void houseNumberChoicesAction({ neighbourhoodId: neighbourhood.value }).then((r) =>
      setHouseChoices(r.ok ? (r.data ?? null) : null),
    );
  }, [neighbourhood]);
  const apartment = isApartmentType(
    f.grade,
    grades.map((g) => ({ code: g.code, name_en: g.name_en })),
  );
  const houseNumbers = houseChoices
    ? Array.from({ length: houseChoices.capacity }, (_, i) =>
        String(i + 1).padStart(2, "0"),
      ).filter((no) => {
        const hit = houseChoices.taken.find((x) => x.house_no === no);
        return !hit || (hit.apartment && apartment);
      })
    : [];
  // A number that became unavailable (other neighbourhood, taken meanwhile) is cleared.
  useEffect(() => {
    if (f.houseNo && houseChoices && !houseNumbers.includes(f.houseNo))
      setF((p) => ({ ...p, houseNo: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseChoices, apartment]);

  // Dropping a pin fills in the neighbourhood and district, and warns about land already registered close by.
  const onPin = async (p: Pin) => {
    setPin(p);
    void nearbyPinsAction({ lon: p.lon, lat: p.lat, excludeId: null }).then((r) =>
      setNearby(
        r.ok && r.data.count > 0
          ? [
              ...(r.data.parcels ?? []).map((x) => `${x.pun} (${x.metres} m)`),
              ...(r.data.applications ?? []).map((x) => `${x.number} (${x.metres} m)`),
            ].join(", ")
          : null,
      ),
    );
    const res = await locatePointAction({ lon: p.lon, lat: p.lat });
    if (!res.ok) return;
    if (!res.data) return setPinPlace(ta("pinNoNeighbourhood"));
    const n = res.data;
    const place = `${locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en} · ${n.district_name_so}`;
    if (locked) {
      // The neighbourhood stays the zone's; only say so when the pin falls somewhere else.
      setPinPlace(n.neighbourhood_id === start!.id ? place : t("pinOutsideZone", { place }));
      return;
    }
    setPinPlace(place);
    setDistrictId(n.district_id);
    setNeighbourhood({
      value: n.neighbourhood_id,
      label: locale === "so" ? n.neighbourhood_name_so : n.neighbourhood_name_en,
      hint: `${n.district_code}-${n.neighbourhood_code}`,
    });
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
      ownerId: owner?.id ?? null,
      ownerName: owner ? "" : f.ownerName,
      ownerPhone: owner ? "" : f.ownerPhone,
      note: f.note,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    router.push(returnTo ?? "/parcels?stage=draft");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="districtId" label={ta("district")} error={fe("districtId")} required>
          <NativeSelect
            value={districtId}
            disabled={locked}
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
        <Field
          id="neighbourhoodId"
          label={ta("neighbourhood")}
          error={fe("neighbourhoodId")}
          hint={locked ? t("neighbourhoodLocked") : ta("neighbourhoodHint")}
        >
          {locked ? (
            <Input
              readOnly
              value={[start!.code, locale === "so" ? start!.name_so : start!.name_en]
                .filter((x, i, all) => x && all.indexOf(x) === i)
                .join(" · ")}
            />
          ) : (
            <AsyncCombobox
              search={searchNeighbourhoods}
              value={neighbourhood ? [neighbourhood] : []}
              onChange={(o) => setNeighbourhood(o[0] ?? null)}
              disabled={!districtId}
              placeholder={ta("chooseNeighbourhood")}
              searchPlaceholder={tc("search")}
              emptyText={tc("noResults")}
            />
          )}
        </Field>
      </div>

      <Field
        id="pin"
        label={ta("pinLabel")}
        hint={pinPlace ?? t("pinHint")}
        error={fe("pin") ?? fe("pinLon")}
        required
      >
        <div>
          <PinPicker
            value={pin}
            onChange={(p) => void onPin(p)}
            outline={outline?.geometry ?? null}
            outlineBbox={outline?.bbox ?? null}
          />
          {nearby && (
            <p
              role="alert"
              className="border-status-rejected/40 bg-status-rejected/10 mt-2 rounded-md border px-3 py-2 text-xs"
            >
              {t("nearby")} {nearby}
            </p>
          )}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="plotWidthM" label={ta("plotWidth")} error={fe("plotWidthM")} required>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={f.width}
            onChange={set("width")}
          />
        </Field>
        <Field id="plotLengthM" label={ta("plotLength")} error={fe("plotLengthM")} required>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={f.length}
            onChange={set("length")}
          />
        </Field>
        <Field id="area" label={t("area")}>
          <Input
            readOnly
            value={Number.isFinite(area) && area > 0 ? `${Math.round(area * 100) / 100} m²` : "—"}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="houseNo"
          label={ta("houseNo")}
          error={fe("houseNo")}
          hint={
            !neighbourhood
              ? t("houseNoPickPlace")
              : houseChoices && houseNumbers.length === 0
                ? t("houseNoFull")
                : undefined
          }
        >
          {/* The neighbourhood code in front, the house number chosen after it: KRWJXL01 | 02. */}
          <div className="flex">
            {houseChoices?.code && (
              <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-s-md border border-e-0 px-3 font-mono text-sm">
                {houseChoices.code}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <NativeSelect
                value={f.houseNo}
                onChange={set("houseNo")}
                disabled={!neighbourhood || !houseChoices}
                className={houseChoices?.code ? "rounded-s-none" : undefined}
              >
                <option value="">{ta("choose")}</option>
                {houseNumbers.map((no) => (
                  <option key={no} value={no}>
                    {no}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
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

      {owner ? (
        <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("ownerName")}:</span>{" "}
          <span className="font-medium">{owner.full_name}</span>
          {owner.phone && (
            <span className="text-muted-foreground ms-2 font-mono text-xs">{owner.phone}</span>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ownerName" label={t("ownerName")} error={fe("ownerName")} required>
            <Input value={f.ownerName} onChange={set("ownerName")} autoComplete="off" />
          </Field>
          <Field
            id="ownerPhone"
            label={t("ownerPhone")}
            hint={t("ownerPhoneHint")}
            error={fe("ownerPhone")}
          >
            <Input
              type="tel"
              value={f.ownerPhone}
              onChange={set("ownerPhone")}
              placeholder="+252 61 123 4567"
              autoComplete="off"
            />
          </Field>
        </div>
      )}

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
