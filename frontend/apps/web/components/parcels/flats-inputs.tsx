"use client";

import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { useFormatter, useTranslations } from "next-intl";
import type { UnitRow, UnitsValue } from "@/components/parcels/land-units-inputs";

/**
 * A block of flats, the simple way (owner's rule, 2026-11-21):
 *   plot 40 × 30 = 1,200 m²; the building covers 600 m², so 1,200 − 600 = 600 m² is empty land.
 *   600 m² over 3 floors = 200 m² a floor; a floor with 2 flats = 100 m² a flat (each floor may have its own count).
 *   A ground-floor flat pays its m² × the base (Apartment) price, a flat above × the Upper Floors price,
 *   and the empty land × the Empty Land price.
 * One owner: they pay all of it. Each flat its own owner: every flat owner pays their flat, the manager the empty land.
 */

const n = (x: string | undefined) => {
  const v = Number(x);
  return x != null && x.trim() !== "" && Number.isFinite(v) && v > 0 ? v : 0;
};
const flatNo = (i: number) => String(i + 1).padStart(2, "0");
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Each floor's number of flats (floor 0, the ground floor, first). */
const counts = (value: UnitsValue) => value.perFloor.slice(0, Math.floor(n(value.levels))).map((x) => Math.floor(n(x)));

/** The flats floor by floor (the ground floor is floor 0): each floor has an equal share of the built area, shared by its flats. */
export function buildFlats(value: UnitsValue): UnitRow[] {
  const levels = Math.floor(n(value.levels));
  const per = counts(value);
  const total = per.reduce((a, b) => a + b, 0);
  if (!levels || per.length < levels || per.some((k) => k < 1) || total > 200) return [];
  const built = n(value.footprint);
  const rows: UnitRow[] = [];
  let given = 0;
  per.forEach((k, floor) => {
    // The last floor takes the rounding so all flats add up to the built area exactly.
    const floorArea = floor === levels - 1 ? round2(built - given) : round2(built / levels);
    given += floorArea;
    const each = round2(floorArea / k);
    for (let j = 0; j < k; j++) {
      const i = rows.length;
      const old = value.units[i];
      const own = built > 0 ? (j === k - 1 ? round2(floorArea - each * (k - 1)) : each) : 0;
      rows.push({ no: flatNo(i), floor: String(floor), own: own > 0 ? String(own) : "", ownerName: old?.ownerName ?? "", ownerPhone: old?.ownerPhone ?? "" });
    }
  });
  return rows;
}

export interface FlatPrices {
  /** Ground-floor flats (Apartment), upper-floor flats (Upper Floors) and the empty land (Empty Land), USD per m². */
  base: number | null;
  upper: number | null;
  empty: number | null;
}

export function FlatsInputs({
  landArea,
  value,
  onChange,
  fixedOwner,
  prices,
  buildingPrice = null,
  chooseOwnership = false,
}: {
  landArea: number;
  value: UnitsValue;
  onChange: (v: UnitsValue) => void;
  /** The owner chosen before (from the owner form): the building's single owner, or its manager. */
  fixedOwner?: { full_name: string; phone: string | null } | null;
  prices: FlatPrices;
  /** One owner: the chosen building type's price per m² for the base (ground floor). */
  buildingPrice?: number | null;
  /** An apartment: ask whether one owner owns it all, or each flat has its own owner (with a manager). */
  chooseOwnership?: boolean;
}) {
  const t = useTranslations("parcels.flats");
  const tu = useTranslations("parcels.landUnits");
  const format = useFormatter();
  const one = value.ownership === "one";
  const m2 = (x: number) => `${format.number(round2(x), { maximumFractionDigits: 2 })} m²`;
  const usd = (x: number) => format.number(x, { style: "currency", currency: "USD" });

  // Change one of the numbers and lay the flats out again.
  const setNums = (patch: Partial<UnitsValue>) => {
    const next = { ...value, ...patch };
    onChange({ ...next, units: buildFlats(next) });
  };
  const setLevels = (levels: string) => {
    const L = Math.min(Math.floor(n(levels)), 100);
    const per = Array.from({ length: L }, (_, i) => value.perFloor[i] ?? value.perFloor[value.perFloor.length - 1] ?? "1");
    setNums({ levels, perFloor: per });
  };
  const setFloorCount = (floor: number, x: string) => setNums({ perFloor: value.perFloor.map((c, i) => (i === floor ? x : c)) });
  const setUnit = (i: number, patch: Partial<UnitRow>) => onChange({ ...value, units: value.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) });

  const land = Number.isFinite(landArea) && landArea > 0 ? landArea : 0;
  const levels = Math.floor(n(value.levels));
  const per = counts(value);
  const built = n(value.footprint);
  const total = per.reduce((a, b) => a + b, 0);
  const empty = land - built;
  const tooBig = land > 0 && built > 0 && empty < 0;
  const tooMany = total > 200;
  const ready = land > 0 && built > 0 && levels > 0 && value.units.length > 0 && !tooBig && !tooMany;
  // Ground floor (base) and upper floors: how many flats and how many m² each.
  const baseUnits = value.units.filter((u) => Number(u.floor) === 0);
  const upperUnits = value.units.filter((u) => Number(u.floor) > 0);
  const area = (list: UnitRow[]) => round2(list.reduce((s, u) => s + n(u.own), 0));
  const line = (a: number, price: number | null) => (price == null ? null : round2(a * price));
  const baseTax = ready ? line(area(baseUnits), prices.base) : null;
  const upperTax = ready ? line(area(upperUnits), prices.upper ?? prices.base) : null;
  const emptyTax = prices.empty == null || !ready ? null : round2(Math.max(empty, 0) * prices.empty);
  // One owner: area × the building's price, plus each upper storey × area × the Upper Floors price, on one invoice.
  const storeys = Math.floor(n(value.upper));
  const upperPrice = prices.upper ?? buildingPrice;
  const oneBase = land > 0 && buildingPrice != null ? round2(land * buildingPrice) : null;
  const oneUpper = land > 0 && upperPrice != null ? round2(storeys * land * upperPrice) : null;
  const oneTotal = oneBase != null && (storeys === 0 || oneUpper != null) ? round2(oneBase + (oneUpper ?? 0)) : null;
  const sum = ready && [baseTax, upperUnits.length ? upperTax : 0, emptyTax].every((x) => x != null) ? round2((baseTax ?? 0) + (upperTax ?? 0) + (emptyTax ?? 0)) : null;

  return (
    <div className="space-y-4 rounded-md border p-4">
      {/* A storey building is always one owner, one land and one invoice (upper storeys included). An apartment asks:
          one owner for everything, or floors and flats with an owner for each flat and a manager for the empty land. */}
      {chooseOwnership && (
        <Field id="flatsOwnership" label={t("ownership")} hint={one ? t("ownershipOneHint") : t("ownershipEachHint")} required>
          <NativeSelect value={value.ownership} onChange={(e) => onChange({ ...value, ownership: e.target.value as UnitsValue["ownership"] })}>
            <option value="each">{t("ownershipEach")}</option>
            <option value="one">{t("ownershipOne")}</option>
          </NativeSelect>
        </Field>
      )}
      {one && (
        <div className="max-w-sm">
          <Field id="upperStoreys" label={t("upperStoreys")} hint={t("upperStoreysHint")}>
            <Input type="number" inputMode="numeric" min={0} max={100} value={value.upper} onChange={(e) => onChange({ ...value, upper: e.target.value })} />
          </Field>
        </div>
      )}

      {!one && (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="floors" label={t("levels")} hint={t("levelsHint")} required>
          <Input type="number" inputMode="numeric" min={1} max={100} value={value.levels} onChange={(e) => setLevels(e.target.value)} />
        </Field>
        <Field id="built" label={t("built")} hint={t("builtHint")} required>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={value.footprint} onChange={(e) => setNums({ footprint: e.target.value })} />
        </Field>
      </div>
      )}

      {/* How many flats on each floor: floor 0 is the ground floor (base), the others are upper floors. */}
      {!one && levels > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t("perFloorTitle")}</h3>
          <div className="divide-y rounded-md border">
            {Array.from({ length: levels }, (_, floor) => {
              const k = per[floor] ?? 0;
              const floorArea = built > 0 ? built / levels : 0;
              return (
                <div key={floor} className="grid items-center gap-3 p-3 text-sm sm:grid-cols-[11rem_8rem_1fr]">
                  <span>{floor === 0 ? t("floorBase") : t("floorUpper", { floor })}</span>
                  <Input
                    aria-label={t("perFloor")}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={200}
                    value={value.perFloor[floor] ?? ""}
                    onChange={(e) => setFloorCount(floor, e.target.value)}
                  />
                  <span className="text-muted-foreground text-xs">
                    {k > 0 && floorArea > 0 ? t("floorShare", { count: k, floorArea: m2(floorArea), each: m2(floorArea / k) }) : t("perFloor")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!one && tooBig && (
        <p role="alert" className="text-danger text-sm">
          {t("builtTooBig", { land: m2(land) })}
        </p>
      )}
      {!one && tooMany && (
        <p role="alert" className="text-danger text-sm">
          {t("tooMany")}
        </p>
      )}

      {/* The numbers worked out, as in the owner's drawing. */}
      {!one && ready && (
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{t("plot")}</dt>
            <dd className="font-semibold tabular-nums">{m2(land)}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{t("emptyLand")}</dt>
            <dd className="font-semibold tabular-nums">{m2(empty)}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{t("built")}</dt>
            <dd className="font-semibold tabular-nums">{m2(built)}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{t("flatsCount")}</dt>
            <dd className="font-semibold tabular-nums">{total}</dd>
          </div>
        </dl>
      )}

      {/* Who pays: the single owner (everything), or the manager (the empty land) with an owner for every flat. */}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">{one ? t("ownerTitle") : t("managerTitle")}</h3>
        {fixedOwner ? (
          <Field id="manager-name" label={one ? t("ownerName") : tu("managerName")} hint={one ? t("ownerPays") : t("managerPays")}>
            <Input readOnly value={`${fixedOwner.full_name}${fixedOwner.phone ? ` · ${fixedOwner.phone}` : ""}`} />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="manager-name" label={one ? t("ownerName") : tu("managerName")} hint={one ? t("ownerPays") : t("managerPays")} required>
              <Input allow="letters" value={value.managerName} maxLength={200} onChange={(e) => onChange({ ...value, managerName: e.target.value })} />
            </Field>
            <Field id="manager-phone" label={tu("phone")}>
              <Input type="tel" inputMode="tel" placeholder="+252…" value={value.managerPhone} onChange={(e) => onChange({ ...value, managerPhone: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      {!one && value.units.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("flatsTitle", { count: value.units.length })}</h3>
          {one ? (
            <p className="text-muted-foreground text-xs">{t("flatsAllOwner")}</p>
          ) : (
            <p className="text-muted-foreground text-xs">{t("flatsEachOwner")}</p>
          )}
          <div className="divide-y rounded-md border">
            {value.units.map((u, i) => {
              const base = Number(u.floor) === 0;
              return (
                <div key={u.no} className={`grid items-center gap-3 p-3 text-sm ${one ? "grid-cols-3" : "sm:grid-cols-[4rem_7rem_6rem_1fr_12rem]"}`}>
                  <span className="font-mono font-medium">{u.no}</span>
                  <span className="text-muted-foreground text-xs">{base ? t("floorBase") : t("floorUpper", { floor: u.floor })}</span>
                  <span className="tabular-nums">{n(u.own) > 0 ? m2(n(u.own)) : "—"}</span>
                  {!one && (
                    <>
                      <Input aria-label={tu("owner")} placeholder={tu("owner")} allow="letters" autoComplete="off" value={u.ownerName} onChange={(e) => setUnit(i, { ownerName: e.target.value })} />
                      <Input aria-label={tu("phone")} placeholder="+252…" type="tel" autoComplete="off" value={u.ownerPhone} onChange={(e) => setUnit(i, { ownerPhone: e.target.value })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* One owner: one invoice, the base and the upper storeys. */}
      {one && land > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("oneInvoiceTitle")}</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <BillRow label={t("billBaseArea", { area: m2(land) })} price={buildingPrice} amount={oneBase} payer={t("payerOwner")} usd={usd} missing={t("noPrice")} />
              {storeys > 0 && (
                <BillRow label={t("billUpperStoreys", { count: storeys, area: m2(land) })} price={upperPrice} amount={oneUpper} payer={t("payerOwner")} usd={usd} missing={t("noPrice")} />
              )}
            </tbody>
            {oneTotal != null && (
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2">{t("billTotal")}</td>
                  <td />
                  <td className="py-2 text-end tabular-nums">{usd(oneTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          <p className="text-muted-foreground text-xs">{t("oneInvoiceNote")}</p>
        </div>
      )}

      {/* What the bills come to with today's Valuation prices. */}
      {!one && ready && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("billTitle")}</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <BillRow
                label={t("billBase", { count: baseUnits.length, area: m2(area(baseUnits)) })}
                price={prices.base}
                amount={baseTax}
                payer={one ? t("payerOwner") : t("payerFlatOwners")}
                usd={usd}
                missing={t("noPrice")}
              />
              {upperUnits.length > 0 && (
                <BillRow
                  label={t("billUpper", { count: upperUnits.length, area: m2(area(upperUnits)) })}
                  price={prices.upper ?? prices.base}
                  amount={upperTax}
                  payer={one ? t("payerOwner") : t("payerFlatOwners")}
                  usd={usd}
                  missing={t("noPrice")}
                />
              )}
              <BillRow label={t("billEmpty", { area: m2(Math.max(empty, 0)) })} price={prices.empty} amount={emptyTax} payer={one ? t("payerOwner") : t("payerManager")} usd={usd} missing={t("noPrice")} />
            </tbody>
            {sum != null && (
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="py-2">{t("billTotal")}</td>
                  <td />
                  <td className="py-2 text-end tabular-nums">{usd(sum)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          <p className="text-muted-foreground text-xs">{t("billNote")}</p>
        </div>
      )}
    </div>
  );
}

function BillRow({ label, price, amount, payer, usd, missing }: { label: string; price: number | null; amount: number | null; payer: string; usd: (x: number) => string; missing: string }) {
  return (
    <tr>
      <td className="py-2 pe-3">{label}</td>
      <td className="text-muted-foreground py-2 pe-3 text-xs tabular-nums">{price == null ? missing : `× ${usd(price)}/m²`}</td>
      <td className="py-2 text-end tabular-nums">{amount == null ? "—" : usd(amount)}</td>
      <td className="text-muted-foreground py-2 ps-3 text-xs">{payer}</td>
    </tr>
  );
}
