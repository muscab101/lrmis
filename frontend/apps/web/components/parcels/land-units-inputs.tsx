"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { missingFloors, splitSharedM2 } from "@/lib/land-units";

export type LandLayout = "house" | "flats" | "compound";
export interface UnitRow {
  no: string;
  floor: string;
  /** Flats: the flat's width and length (m); its own m² is worked out from them. */
  width?: string;
  length?: string;
  own: string;
  ownerName: string;
  ownerPhone: string;
}
export interface SpaceRow {
  name: string;
  area: string;
}
export interface UnitsValue {
  floors: string;
  /** Flats: one owner for the whole building, or each flat its own owner (the manager pays the empty land). */
  ownership: "one" | "each";
  /** Flats: how many floors including the ground floor, and how many flats on each floor (floor 0 first). */
  levels: string;
  perFloor: string[];
  /** Flats with one owner: storeys above the ground floor, billed on the one invoice. */
  upper: string;
  /** Flats: the ground the building covers (m², the built area); the rest of the plot is empty land. */
  footprint: string;
  managerName: string;
  managerPhone: string;
  split: "equal" | "by_size";
  units: UnitRow[];
  spaces: SpaceRow[];
}

const emptyRow = (no: string): UnitRow => ({
  no,
  floor: "0",
  own: "",
  ownerName: "",
  ownerPhone: "",
});
const flatNo = (i: number) => String(i + 1).padStart(2, "0");
const houseNo = (i: number) =>
  String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

/** What a new building or compound starts with: two units to fill in. */
export function startUnits(layout: LandLayout): UnitsValue {
  const name = layout === "flats" ? flatNo : houseNo;
  return {
    floors: "1",
    ownership: "one",
    levels: "",
    perFloor: [],
    upper: "",
    footprint: "",
    managerName: "",
    managerPhone: "",
    split: "equal",
    // Flats are laid out from the floors and flats per floor; a compound starts with two houses to fill in.
    units: layout === "flats" ? [] : [emptyRow(name(0)), emptyRow(name(1))],
    spaces: [],
  };
}

const positive = (x: string) => {
  const n = Number(x);
  return x.trim() !== "" && Number.isFinite(n) && n > 0 ? n : 0;
};
const m2 = (n: number) => `${Math.round(n * 100) / 100} m²`;
/** Width × length as text (empty until both are numbers above 0). */
const sizeOf = (w: string, l: string) => {
  const a = positive(w) * positive(l);
  return a > 0 ? String(Math.round(a * 100) / 100) : "";
};

/** The extra inputs for a flats building or a shared compound, and on a compound what each house ends up with. */
export function LandUnitsInputs({
  layout,
  landArea,
  value,
  onChange,
  fixedOwner,
}: {
  layout: "flats" | "compound";
  landArea: number;
  value: UnitsValue;
  onChange: (v: UnitsValue) => void;
  /** The owner just entered with the full owner form: a compound's first house, or a flats building's manager. */
  fixedOwner?: { full_name: string; phone: string | null } | null;
}) {
  const t = useTranslations("parcels.landUnits");
  const flats = layout === "flats";
  const setUnit = (i: number, patch: Partial<UnitRow>) =>
    onChange({ ...value, units: value.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
  const setSpace = (i: number, patch: Partial<SpaceRow>) =>
    onChange({ ...value, spaces: value.spaces.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const nextNo = () => {
    const taken = new Set(value.units.map((u) => u.no.trim().toUpperCase()));
    const name = flats ? flatNo : houseNo;
    let i = value.units.length;
    while (taken.has(name(i))) i += 1;
    return name(i);
  };

  // What the compound's numbers come to, shown as they are typed.
  const land = Number.isFinite(landArea) && landArea > 0 ? landArea : 0;
  const own = value.units.map((u) => positive(u.own));
  const ownSum = own.reduce((s, x) => s + x, 0);
  const named = value.spaces.reduce((s, x) => s + positive(x.area), 0);
  const shared = land - ownSum;
  const empty = shared - named;
  const allSized = land > 0 && own.every((x) => x > 0);
  const tooBig = allSized && (shared < 0 || empty < 0);
  const parts = allSized && !tooBig ? splitSharedM2(own, shared, value.split) : null;
  // Flats: floors with no flat yet (a reminder, not a block: a floor may truly be empty).
  const missing = flats
    ? missingFloors(
        Number(value.floors),
        value.units.map((u) => u.floor),
      )
    : [];

  return (
    <div className="space-y-4 rounded-md border p-4">
      {flats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="floors" label={t("floors")} hint={t("floorsHint")} required>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={value.floors}
              onChange={(e) => onChange({ ...value, floors: e.target.value })}
            />
          </Field>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{flats ? t("flatsTitle") : t("housesTitle")}</h3>
        {missing.length > 0 && (
          <p
            role="status"
            className="bg-status-pending/10 text-status-pending rounded-md px-3 py-2 text-xs"
          >
            {t("missingFloors", { count: missing.length, list: missing.join(", ") })}
          </p>
        )}
        {value.units.map((u, i) => (
          <div
            key={i}
            className={`bg-muted/30 grid items-start gap-3 rounded-md border p-3 ${flats ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-6"}`}
          >
            <Field id={`unit-no-${i}`} label={flats ? t("flatNo") : t("houseLetter")} required>
              <Input
                value={u.no}
                maxLength={6}
                onChange={(e) => setUnit(i, { no: e.target.value })}
              />
            </Field>
            {flats && (
              <Field id={`unit-floor-${i}`} label={t("floor")} required>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={u.floor}
                  onChange={(e) => setUnit(i, { floor: e.target.value })}
                />
              </Field>
            )}
            {flats ? (
              <>
                {/* Width × length: the flat's m² is worked out (shown under the row). */}
                <Field id={`unit-w-${i}`} label={t("flatWidth")} required>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={u.width ?? ""}
                    onChange={(e) =>
                      setUnit(i, {
                        width: e.target.value,
                        own: sizeOf(e.target.value, u.length ?? ""),
                      })
                    }
                  />
                </Field>
                <Field id={`unit-l-${i}`} label={t("flatLength")} required>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={u.length ?? ""}
                    onChange={(e) =>
                      setUnit(i, {
                        length: e.target.value,
                        own: sizeOf(u.width ?? "", e.target.value),
                      })
                    }
                  />
                </Field>
              </>
            ) : (
              <Field id={`unit-own-${i}`} label={t("ownM2")} required>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={u.own}
                  onChange={(e) => setUnit(i, { own: e.target.value })}
                />
              </Field>
            )}
            {i === 0 && fixedOwner && !flats ? (
              <Field id="unit-owner-0" label={t("owner")} className="sm:col-span-2">
                <Input readOnly value={fixedOwner.full_name} />
              </Field>
            ) : (
              <>
                <Field id={`unit-owner-${i}`} label={t("owner")} required className="sm:col-span-2">
                  <Input
                    allow="letters"
                    value={u.ownerName}
                    autoComplete="off"
                    onChange={(e) => setUnit(i, { ownerName: e.target.value })}
                  />
                </Field>
                <Field id={`unit-phone-${i}`} label={t("phone")}>
                  <Input
                    type="tel"
                    value={u.ownerPhone}
                    autoComplete="off"
                    placeholder="+252…"
                    onChange={(e) => setUnit(i, { ownerPhone: e.target.value })}
                  />
                </Field>
              </>
            )}
            {flats && u.floor.trim() !== "" && (
              <p className="text-muted-foreground text-xs sm:col-span-6">
                {positive(u.own) > 0 && (
                  <span className="text-foreground font-medium">{m2(positive(u.own))} · </span>
                )}
                {Number(u.floor) === 0 ? t("floorBase") : t("floorUpper", { floor: u.floor })}
              </p>
            )}
            {!flats && parts && (
              <p className="text-muted-foreground text-xs sm:col-span-5">
                {t("houseTotal", {
                  own: m2(own[i]!),
                  shared: m2(parts[i]!),
                  total: m2(own[i]! + parts[i]!),
                })}
              </p>
            )}
            {/* The owner from the owner form stays with the first row, so that row stays too. */}
            {value.units.length > 2 && !(i === 0 && fixedOwner && !flats) && (
              <div className="flex justify-end sm:col-span-6">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() =>
                    onChange({ ...value, units: value.units.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 aria-hidden />
                  {t("removeUnit")}
                </Button>
              </div>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...value, units: [...value.units, emptyRow(nextNo())] })}
        >
          <Plus aria-hidden />
          {flats ? t("addFlat") : t("addHouse")}
        </Button>
      </div>

      {/* Flats: the plot, the flats added up and the rest of the plot; then who pays that rest (the manager). */}
      {flats && (
        <div className="space-y-3 border-t pt-4">
          {land > 0 && (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-muted/40 rounded-md px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("plotM2")}</dt>
                <dd className="font-semibold tabular-nums">{m2(land)}</dd>
              </div>
              <div className="bg-muted/40 rounded-md px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("flatsM2")}</dt>
                <dd className="font-semibold tabular-nums">{m2(ownSum)}</dd>
              </div>
              <div className="bg-primary-soft rounded-md px-3 py-2">
                <dt className="text-muted-foreground text-xs">{t("restM2")}</dt>
                <dd className="text-primary font-semibold tabular-nums">
                  {m2(Math.max(land - ownSum, 0))}
                </dd>
              </div>
            </dl>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* The manager pays the rest of the plot: the owner just entered, or a person typed here. */}
            {fixedOwner ? (
              <Field
                id="manager-name"
                label={t("managerName")}
                hint={t("managerIsOwner")}
                className="sm:col-span-2"
              >
                <Input
                  readOnly
                  value={`${fixedOwner.full_name}${fixedOwner.phone ? ` · ${fixedOwner.phone}` : ""}`}
                />
              </Field>
            ) : (
              <>
                <Field id="manager-name" label={t("managerName")} hint={t("managerHint")}>
                  <Input
                    allow="letters"
                    value={value.managerName}
                    maxLength={200}
                    onChange={(e) => onChange({ ...value, managerName: e.target.value })}
                  />
                </Field>
                <Field id="manager-phone" label={t("managerPhone")}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    value={value.managerPhone}
                    onChange={(e) => onChange({ ...value, managerPhone: e.target.value })}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      )}

      {!flats && (
        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">{t("sharedTitle")}</h3>
            <p className="text-muted-foreground text-xs">{t("sharedHint")}</p>
          </div>
          {value.spaces.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field id={`space-name-${i}`} label={t("spaceName")} required>
                  <Input
                    value={s.name}
                    placeholder={t("spaceExample")}
                    onChange={(e) => setSpace(i, { name: e.target.value })}
                  />
                </Field>
              </div>
              <div className="w-28">
                <Field id={`space-area-${i}`} label="m²" required>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    value={s.area}
                    onChange={(e) => setSpace(i, { area: e.target.value })}
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-danger"
                aria-label={t("removeSpace")}
                onClick={() =>
                  onChange({ ...value, spaces: value.spaces.filter((_, j) => j !== i) })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({ ...value, spaces: [...value.spaces, { name: "", area: "" }] })
            }
          >
            <Plus aria-hidden />
            {t("addSpace")}
          </Button>

          <div className="max-w-sm">
            <Field id="sharedSplit" label={t("split")} required>
              <NativeSelect
                value={value.split}
                onChange={(e) =>
                  onChange({ ...value, split: e.target.value as UnitsValue["split"] })
                }
              >
                <option value="equal">{t("splitEqual")}</option>
                <option value="by_size">{t("splitBySize")}</option>
              </NativeSelect>
            </Field>
          </div>

          {tooBig ? (
            <p role="alert" className="text-danger text-sm">
              {t("tooBig", { land: m2(land) })}
            </p>
          ) : (
            allSized && (
              <p className="text-sm">
                {t("sharedSummary", {
                  land: m2(land),
                  houses: m2(ownSum),
                  shared: m2(shared),
                  empty: m2(empty),
                })}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
