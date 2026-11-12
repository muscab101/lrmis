"use client";

import type { ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { neighbourhoodPricesAction } from "@/app/[locale]/(staff)/valuation/actions";
import type { Grade } from "@/lib/server/valuation";
import { NeighbourhoodPicker } from "./neighbourhood-picker";

/**
 * Price check: what a house will be billed a year — choose the neighbourhood, the house type and the size. Uses the
 * neighbourhood's own price for the type when it has one (Rates), else the type's normal price; plus the service charge.
 */
export function PriceCheck({ grades, serviceCharge }: { grades: Grade[]; serviceCharge: number }) {
  const t = useTranslations("valuation.priceCheck");
  const format = useFormatter();
  const locale = useLocale();
  const usd = (n: number, digits = 2) => format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: digits });
  const active = grades.filter((g) => g.active && g.code !== "open_ground");
  const [place, setPlace] = useState<ComboOption | null>(null);
  const [own, setOwn] = useState<Record<string, number>>({});
  const [gradeId, setGradeId] = useState(active[0]?.id ?? "");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");

  useEffect(() => {
    let live = true;
    if (!place) {
      setOwn({});
      return;
    }
    void neighbourhoodPricesAction({ neighbourhoodId: place.value }).then((res) => live && setOwn(res.ok ? res.data : {}));
    return () => {
      live = false;
    };
  }, [place]);

  const grade = active.find((g) => g.id === gradeId) ?? null;
  const price = grade ? (own[grade.id] ?? Number(grade.amount)) : 0;
  const area = Math.round(Number(width) * Number(length) * 100) / 100;
  const tax = area > 0 ? Math.round(area * price * 100) / 100 : 0;
  const ready = grade && area > 0;

  return (
    <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pc-place" label={t("neighbourhood")} hint={place ? (grade && own[grade.id] != null ? t("ownPrice") : t("normalPrice")) : t("anyPlace")}>
          <NeighbourhoodPicker value={place} onChange={setPlace} />
        </Field>
        <Field id="pc-type" label={t("houseType")}>
          <NativeSelect value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            {active.map((g) => (
              <option key={g.id} value={g.id}>
                {locale === "so" ? g.name_so : g.name_en}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="pc-width" label={t("width")}>
          <Input type="number" inputMode="decimal" min={0} value={width} onChange={(e) => setWidth(e.target.value)} />
        </Field>
        <Field id="pc-length" label={t("length")}>
          <Input type="number" inputMode="decimal" min={0} value={length} onChange={(e) => setLength(e.target.value)} />
        </Field>
      </div>
      <dl className="bg-muted/40 space-y-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("size")}</dt>
          <dd className="tabular-nums">{area > 0 ? `${area} m²` : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("pricePerM2")}</dt>
          <dd className="tabular-nums">{grade ? usd(price, 4) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("taxBill")}</dt>
          <dd className="tabular-nums">{ready ? usd(tax) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("serviceCharge")}</dt>
          <dd className="tabular-nums">{usd(serviceCharge)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
          <dt>{t("total")}</dt>
          <dd className="tabular-nums">{ready ? usd(tax + serviceCharge) : "—"}</dd>
        </div>
        <p className="text-muted-foreground pt-1 text-xs">{t("note")}</p>
      </dl>
    </div>
  );
}
