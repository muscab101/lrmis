"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { billingPlacesAction, createRunAction } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

interface Props {
  districts: { id: string; code: string; name_so: string; name_en: string }[];
  feeTypes: { id: string; code: string; name_so: string; name_en: string; interval: string }[];
}

type Place = { id: string; code: string; name_so: string; name_en: string };

/** A box of tick boxes for places, with a count of how many are ticked. */
function PlaceList({ label, places, chosen, onChange, empty }: { label: string; places: Place[]; chosen: string[]; onChange: (ids: string[]) => void; empty: string }) {
  const locale = useLocale();
  return (
    <div>
      <p className="mb-1 text-sm font-medium">
        {label} {chosen.length > 0 && <span className="text-primary">({chosen.length})</span>}
      </p>
      {places.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
          {places.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={chosen.includes(p.id)} onCheckedChange={(c) => onChange(c === true ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />
              <span className="truncate">{[p.code, locale === "so" ? p.name_so : p.name_en].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ")}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Step 1 of the billing-run wizard: period, fee, districts and (optionally) places inside them. The preview follows on the run page. */
export function NewRunButton({ districts, feeTypes }: Props) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const router = useRouter();
  const recurring = feeTypes.filter((f) => f.interval !== "one_off");
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    year: String(year),
    feeTypeId: recurring[0]?.id ?? "",
    districtIds: [] as string[],
    sectionIds: [] as string[],
    sectorIds: [] as string[],
    neighbourhoodIds: [] as string[],
    dueDate: `${year}-12-31`,
    note: "",
  });
  // Unticking a district drops the places chosen inside it (the lists reload below).
  const toggle = (id: string, on: boolean) =>
    setV((s) => ({ ...s, districtIds: on ? [...s.districtIds, id] : s.districtIds.filter((d) => d !== id), sectionIds: [], sectorIds: [], neighbourhoodIds: [] }));
  const [places, setPlaces] = useState<{ sections: Place[]; sectors: Place[]; neighbourhoods: Place[] }>({ sections: [], sectors: [], neighbourhoods: [] });
  useEffect(() => {
    let live = true;
    void billingPlacesAction({ districtIds: v.districtIds, sectionIds: v.sectionIds, sectorIds: v.sectorIds }).then((r) => {
      if (!live || !r.ok) return;
      setPlaces(r.data);
      // Keep only choices that are still in the lists.
      // (Only when something was dropped: a new array would reload the lists again.)
      setV((s) => {
        const sectorIds = s.sectorIds.filter((x) => r.data.sectors.some((p) => p.id === x));
        const neighbourhoodIds = s.neighbourhoodIds.filter((x) => r.data.neighbourhoods.some((p) => p.id === x));
        return sectorIds.length === s.sectorIds.length && neighbourhoodIds.length === s.neighbourhoodIds.length ? s : { ...s, sectorIds, neighbourhoodIds };
      });
    });
    return () => {
      live = false;
    };
  }, [v.districtIds, v.sectionIds, v.sectorIds]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("newRun")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("newRun")}
        description={t("newRunBody")}
        confirmLabel={t("preview")}
        submit={() => createRunAction(v)}
        onDone={(d) => router.push(`/billing/runs/${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="year" label={t("year")} error={fe("year")} required>
                <Input type="number" min={2000} max={2100} value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} />
              </Field>
              <Field id="due" label={t("dueDate")} error={fe("dueDate")} required>
                <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
              </Field>
            </div>
            <Field id="fee" label={t("feeType")} hint={t("feeTypeHint")} error={fe("feeTypeId")} required>
              <NativeSelect value={v.feeTypeId} onChange={(e) => setV({ ...v, feeTypeId: e.target.value })}>
                {recurring.map((f) => (
                  <option key={f.id} value={f.id}>
                    {locale === "so" ? f.name_so : f.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="districts" label={t("districts")} error={fe("districtIds")} required>
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3">
                {districts.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={v.districtIds.includes(d.id)} onCheckedChange={(c) => toggle(d.id, c === true)} />
                    {locale === "so" ? d.name_so : d.name_en}
                  </label>
                ))}
              </div>
            </Field>
            {v.districtIds.length > 0 && (
              <Field id="places" label={t("placesLabel")} hint={t("placesHint")} error={fe("places")}>
                <div className="space-y-3">
                  <PlaceList label={t("placeSections")} places={places.sections} chosen={v.sectionIds} onChange={(ids) => setV({ ...v, sectionIds: ids })} empty={t("noPlaces")} />
                  {v.sectionIds.length > 0 && (
                    <PlaceList label={t("placeSectors")} places={places.sectors} chosen={v.sectorIds} onChange={(ids) => setV({ ...v, sectorIds: ids })} empty={t("noPlaces")} />
                  )}
                  {v.sectorIds.length > 0 && (
                    <PlaceList
                      label={t("placeNeighbourhoods")}
                      places={places.neighbourhoods}
                      chosen={v.neighbourhoodIds}
                      onChange={(ids) => setV({ ...v, neighbourhoodIds: ids })}
                      empty={t("noPlaces")}
                    />
                  )}
                </div>
              </Field>
            )}
            <Field id="note" label={t("noteOptional")}>
              <Input value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} />
            </Field>
          </>
        )}
      </FormDialog>
    </>
  );
}
