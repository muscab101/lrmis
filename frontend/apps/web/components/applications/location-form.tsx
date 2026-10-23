"use client";

import type { AppError } from "@dhulka/core/errors";
import { APPLICATION_TYPES, LAND_USES, OFFICE_APPLICATION_TYPES, type ApplicationType, type LandUse } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { createApplicationAction, houseNumbersTakenAction, nearbyPinsAction, setApplicationPartiesAction, updateApplicationAction } from "@/app/[locale]/(staff)/applications/actions";
import { getGeometryAction, locatePointAction, searchNeighbourhoodsAction } from "@/app/[locale]/(staff)/locations/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import { PinPicker, type Pin } from "./pin-picker";
import { isApartmentType } from "@/lib/apartment";

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
  houseNo: string;
  /** Only asked for an apartment. */
  flatNo: string;
  govtReceiptNo: string;
  /** A code from the admin's property-type list. */
  propertyType: string;
  landUse: LandUse | "";
  plotWidthM: string;
  plotLengthM: string;
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
  /** Staff need the capture-location permission to set or move the pin. */
  canCaptureLocation?: boolean;
  /** Shown under the map for a saved pin: when and how it was captured. */
  captured?: { at: string | null; lowAccuracy: boolean } | null;
  /** Staff only: put this owner on the new application (the + key on the owners list). */
  ownerId?: string;
  /** The types of house / land: Valuation → Property grades, priced per m². */
  propertyTypes?: { code: string; name_so: string; name_en: string; price: number; currency: string; active: boolean }[];
}

const OFFLINE_KEY = "lrmis.offline-location";
/** House numbers offered in each neighbourhood: 01 … 50. */
const HOUSE_NUMBERS = 50;

/** Step 1 — what and where: type, district, neighbourhood, map pin, plot / deed numbers. */
export function LocationForm({ mode, applicationId, initial, districts, isStaff, basePath, readOnly = false, onSaved, canCaptureLocation = true, captured = null, ownerId, propertyTypes = [] }: Props) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const ts = useTranslations("stage");
  const locale = useLocale();
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const [v, setV] = useState<LocationValues>(initial);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const [outline, setOutline] = useState<{ geometry: GeoJSON.Geometry; bbox: [number, number, number, number] } | null>(null);
  const [pinPlace, setPinPlace] = useState<string | null>(null);
  const [nearby, setNearby] = useState<{ count: number; parcels?: { pun: string; metres: number }[]; applications?: { number: string; metres: number }[] } | null>(null);
  const [offline, setOffline] = useState(false);
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
      void nearbyPinsAction({ lon: pin.lon, lat: pin.lat, excludeId: applicationId ?? null }).then((r) => setNearby(r.ok && r.data.count > 0 ? r.data : null));
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
    [locale, t, applicationId],
  );

  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);

  const num = (x: string) => (x.trim() === "" ? null : Number(x));
  const declaredArea = num(v.plotWidthM) && num(v.plotLengthM) ? Math.round(num(v.plotWidthM)! * num(v.plotLengthM)! * 100) / 100 : null;
  const apartment = isApartmentType(v.propertyType, propertyTypes);

  // House numbers already given to other land in the chosen neighbourhood.
  const [takenHouses, setTakenHouses] = useState<{ house_no: string; apartment: boolean }[] | null>(null);
  useEffect(() => {
    setTakenHouses(null);
    if (!v.neighbourhood) return;
    let live = true;
    void houseNumbersTakenAction({ neighbourhoodId: v.neighbourhood.value, applicationId: applicationId ?? null }).then((r) => {
      if (live) setTakenHouses(r.ok ? (r.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [v.neighbourhood, applicationId]);
  // 01–50, without the taken ones; an apartment's number stays for other flats of an apartment.
  const houseOptions = (() => {
    const taken = new Map((takenHouses ?? []).map((h) => [h.house_no, h.apartment]));
    const list = Array.from({ length: HOUSE_NUMBERS }, (_, i) => String(i + 1).padStart(2, "0"))
      .filter((n) => !taken.has(n) || (apartment && taken.get(n)))
      .map((n) => ({ value: n, shared: taken.has(n) }));
    // Keep the saved number even if it's outside the list (typed in before the list existed).
    if (v.houseNo && !taken.has(v.houseNo) && !list.some((o) => o.value === v.houseNo)) list.unshift({ value: v.houseNo, shared: false });
    return list;
  })();
  // A number taken in this neighbourhood is cleared (e.g. after moving the pin); a new house starts on the first free one.
  useEffect(() => {
    if (readOnly || takenHouses === null) return;
    const ok = !v.houseNo || houseOptions.some((o) => o.value === v.houseNo);
    if (ok && v.houseNo) return;
    const first = mode === "create" ? houseOptions.find((o) => !o.shared) : undefined;
    set("houseNo", first?.value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takenHouses]);

  async function save(fromQueue = false) {
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
      pinMethod: v.pin ? (v.pin.method ?? (v.pin.accuracy ? "gps" : "manual")) : null,
      plotWidthM: num(v.plotWidthM),
      plotLengthM: num(v.plotLengthM),
      addressNote: v.addressNote,
      plotNo: v.plotNo,
      oldDeedNo: v.oldDeedNo,
      govtFileNo: v.govtFileNo,
      houseNo: v.houseNo,
      flatNo: apartment ? v.flatNo : "",
      govtReceiptNo: v.govtReceiptNo,
      propertyType: v.propertyType ?? "",
      landUse: v.landUse ?? "",
    };
    try {
      if (mode === "create") {
        const res = await createApplicationAction({ ...payload, idempotencyKey });
        setSaving(false);
        if (!res.ok) return setError(res.error);
        clearQueued();
        if (ownerId) {
          // The application exists either way; a failure here only means adding the owner by hand.
          const added = await setApplicationPartiesAction({ applicationId: res.data!.id, parties: [{ partyId: ownerId, role: "owner", sharePct: 100 }] });
          if (!added.ok) toast.error(t("ownerNotAdded"));
        }
        toast.success(t("draftCreated", { number: res.data!.number }));
        router.push(`${basePath}/${res.data!.id}?tab=${ownerId ? "documents" : "owners"}`);
        return;
      }
      const res = await updateApplicationAction({ ...payload, applicationId: applicationId! });
      setSaving(false);
      if (!res.ok) return setError(res.error);
      clearQueued();
      toast.success(tc("saved"));
      onSaved?.();
      router.refresh();
    } catch {
      // No connection: keep the entry on this device and send it when the network is back.
      setSaving(false);
      if (!fromQueue) {
        try {
          localStorage.setItem(OFFLINE_KEY, JSON.stringify({ mode, applicationId: applicationId ?? null, v, at: Date.now() }));
        } catch {
          /* storage blocked */
        }
      }
      setOffline(true);
    }
  }
  function clearQueued() {
    setOffline(false);
    try {
      localStorage.removeItem(OFFLINE_KEY);
    } catch {
      /* storage blocked */
    }
  }
  // Restore an entry kept while offline (same form), and send it once the connection returns.
  useEffect(() => {
    if (readOnly) return;
    try {
      const raw = localStorage.getItem(OFFLINE_KEY);
      const q = raw ? (JSON.parse(raw) as { mode: string; applicationId: string | null; v: LocationValues }) : null;
      if (q && q.mode === mode && q.applicationId === (applicationId ?? null)) {
        setV(q.v);
        setOffline(true);
      }
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!offline) return;
    const retry = () => void save(true);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline, v]);

  return (
    <div className="space-y-5">
      <FormError error={error && error.code !== "VALIDATION" ? error : null} />
      {offline && (
        <p role="status" className="rounded-md border border-status-pending/40 bg-status-pending/10 px-3 py-2 text-sm">
          {t("pin.savedOffline")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="type" label={t("type")} required>
          <NativeSelect value={v.type} disabled={readOnly || mode === "edit"} onChange={(e) => set("type", e.target.value as ApplicationType)}>
            {/* Staff creating new: the office types (new land goes through survey zones); editing shows the saved type. */}
            {(mode === "create" && isStaff ? OFFICE_APPLICATION_TYPES : APPLICATION_TYPES).map((ty) => (
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
          <PinPicker value={v.pin} onChange={(p) => void onPin(p)} disabled={readOnly || !canCaptureLocation} outline={outline?.geometry ?? null} outlineBbox={outline?.bbox ?? null} />
          {!readOnly && !canCaptureLocation && <p className="mt-1 text-xs text-muted-foreground">{t("pin.noPermission")}</p>}
          {captured?.at && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pin.capturedAt", { date: new Date(captured.at).toLocaleString(locale === "so" ? "so-SO" : "en-GB") })}
              {captured.lowAccuracy && <span className="ms-2 rounded-sm bg-status-pending/15 px-1.5 py-0.5 text-foreground">{t("pin.lowAccuracyFlag")}</span>}
            </p>
          )}
          {nearby && (
            <p role="alert" className="mt-2 rounded-md border border-status-rejected/40 bg-status-rejected/10 px-3 py-2 text-xs">
              {t("pin.nearby", { n: nearby.count })}{" "}
              {[...(nearby.parcels ?? []).map((x) => `${x.pun} (${x.metres} m)`), ...(nearby.applications ?? []).map((x) => `${x.number} (${x.metres} m)`)].join(", ")}
            </p>
          )}
        </div>
      </Field>

      {/* What is on the land, and what it's used for (the default land use when it's registered). */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="propertyType" label={t("propertyType")} hint={t("propertyTypeHint")} error={fe("propertyType")}>
          <NativeSelect value={v.propertyType ?? ""} disabled={readOnly} onChange={(e) => set("propertyType", e.target.value)}>
            <option value="">{t("choose")}</option>
            {/* Active types, plus the saved one if an admin has since hidden it. */}
            {propertyTypes
              .filter((p) => p.active || p.code === v.propertyType)
              .map((p) => (
                <option key={p.code} value={p.code}>
                  {locale === "so" ? p.name_so : p.name_en}
                  {Number(p.price) > 0 ? ` — ${format.number(Number(p.price), { style: "currency", currency: p.currency })} / m²` : ""}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="landUse" label={ts("landUse")} error={fe("landUse")}>
          <NativeSelect value={v.landUse ?? ""} disabled={readOnly} onChange={(e) => set("landUse", e.target.value as LandUse | "")}>
            <option value="">{t("choose")}</option>
            {LAND_USES.map((u) => (
              <option key={u} value={u}>
                {ts(`landUses.${u}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="plotWidthM" label={t("plotWidth")} error={fe("plotWidthM")}>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.plotWidthM} disabled={readOnly} onChange={(e) => set("plotWidthM", e.target.value)} />
        </Field>
        <Field id="plotLengthM" label={t("plotLength")} error={fe("plotLengthM")}>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={v.plotLengthM} disabled={readOnly} onChange={(e) => set("plotLengthM", e.target.value)} />
        </Field>
        <Field id="declaredArea" label={t("declaredArea")}>
          <p className="flex h-9 items-center text-sm tabular-nums">{declaredArea ? `${declaredArea} m²` : "—"}</p>
        </Field>
      </div>

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
        {/* The house is read as "<neighbourhood> · <House No>": pick a free number (01–50) in the chosen neighbourhood. */}
        <Field id="houseNo" label={t("houseNo")} hint={v.neighbourhood ? undefined : t("houseNoHint")} error={fe("houseNo")}>
          <div className="flex min-w-0">
            {v.neighbourhood && (
              <span className="bg-muted text-muted-foreground flex max-w-[55%] shrink-0 items-center truncate rounded-s-md border border-e-0 px-2.5 text-sm" title={v.neighbourhood.label}>
                {v.neighbourhood.label}
              </span>
            )}
            <NativeSelect
              id="houseNo"
              value={v.houseNo}
              disabled={readOnly || !v.neighbourhood}
              className={v.neighbourhood ? "min-w-0 flex-1 rounded-s-none" : "flex-1"}
              onChange={(e) => set("houseNo", e.target.value)}
            >
              <option value="">{v.neighbourhood ? t("choose") : t("houseNoPickNeighbourhood")}</option>
              {houseOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.shared ? `${o.value} — ${t("houseNoApartment")}` : o.value}
                </option>
              ))}
            </NativeSelect>
          </div>
        </Field>
        {apartment && (
          <Field id="flatNo" label={t("flatNo")} hint={t("flatNoHint")} error={fe("flatNo")}>
            <Input value={v.flatNo} maxLength={20} disabled={readOnly} onChange={(e) => set("flatNo", e.target.value)} />
          </Field>
        )}
        {/* A paper government receipt the office has seen; citizens don't enter it. */}
        {isStaff && (
          <Field id="govtReceiptNo" label={t("govtReceiptNo")} hint={t("govtReceiptHint")} error={fe("govtReceiptNo")} className="sm:col-span-2">
            <Input value={v.govtReceiptNo} maxLength={60} disabled={readOnly} onChange={(e) => set("govtReceiptNo", e.target.value)} />
          </Field>
        )}
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
          <Button type="button" loading={saving} disabled={!v.districtId} onClick={() => void save(false)}>
            {mode === "create" ? t("startApplication") : tc("saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}
