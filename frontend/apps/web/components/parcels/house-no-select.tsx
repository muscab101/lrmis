"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { houseNumberChoicesAction } from "@/app/[locale]/(staff)/parcels/actions";

type Source = { neighbourhoodId: string | null } | { parcelId: string } | { surveyId: string };
type Choices = {
  code: string | null;
  capacity: number;
  taken: { house_no: string; apartment: boolean }[];
};

/**
 * House No as a list: 01 up to the neighbourhood's capacity, without the numbers other land there already has (flats
 * in one block may share a number). A current value that isn't in the list (an old free-text number) stays selectable.
 */
export function HouseNoSelect({
  source,
  value,
  onChange,
  apartment = false,
  id,
}: {
  source: Source;
  value: string;
  onChange: (v: string) => void;
  apartment?: boolean;
  id?: string;
}) {
  const t = useTranslations("parcels.fieldLand");
  const ta = useTranslations("applications");
  const [choices, setChoices] = useState<Choices | null>(null);
  const key = JSON.stringify(source);
  const noPlace = "neighbourhoodId" in source && !source.neighbourhoodId;
  useEffect(() => {
    setChoices(null);
    if (noPlace) return;
    void houseNumberChoicesAction({
      neighbourhoodId: null,
      parcelId: null,
      surveyId: null,
      ...source,
    }).then((r) => setChoices(r.ok ? (r.data ?? null) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const numbers = choices
    ? Array.from({ length: choices.capacity }, (_, i) => String(i + 1).padStart(2, "0")).filter(
        (no) => {
          const hit = choices.taken.find((x) => x.house_no === no);
          return !hit || (hit.apartment && apartment);
        },
      )
    : [];
  // A number that became unavailable (another neighbourhood, taken meanwhile) is cleared, unless it was already saved.
  const [initial] = useState(value);
  useEffect(() => {
    if (value && value !== initial && choices && !numbers.includes(value)) onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, apartment]);
  return (
    <>
      <div className="flex">
        {choices?.code && (
          <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-s-md border border-e-0 px-3 font-mono text-sm">
            {choices.code}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <NativeSelect
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={noPlace || !choices}
            className={choices?.code ? "rounded-s-none" : undefined}
          >
            <option value="">{ta("choose")}</option>
            {initial && !numbers.includes(initial) && <option value={initial}>{initial}</option>}
            {numbers.map((no) => (
              <option key={no} value={no}>
                {no}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {noPlace && <p className="text-muted-foreground mt-1 text-xs">{t("houseNoPickPlace")}</p>}
      {choices && numbers.length === 0 && (
        <p className="text-muted-foreground mt-1 text-xs">{t("houseNoFull")}</p>
      )}
    </>
  );
}
