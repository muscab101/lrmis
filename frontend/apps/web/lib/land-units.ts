/** How the shared m² of a compound go to its houses. The database works it out the same way when saving. */
export function splitSharedM2(own: number[], shared: number, split: "equal" | "by_size"): number[] {
  const sum = own.reduce((s, x) => s + x, 0);
  let given = 0;
  return own.map((x, i) => {
    const round = (n: number) => Math.round(n * 100) / 100;
    // The last house takes the rounding, so the totals always add up to the land.
    const part =
      i === own.length - 1
        ? round(shared - given)
        : round(split === "by_size" ? (shared * x) / sum : shared / own.length);
    given += part;
    return part;
  });
}

/**
 * A flats building's floors that have no flat yet: floors 1 up to the number of floors entered (the ground floor, 0,
 * may hold shops or parking, so it is never "missing"). E.g. 5 floors with flats on 1, 2, 3 and 5 → [4].
 */
export function missingFloors(floors: number | null | undefined, unitFloors: (number | string | null | undefined)[]): number[] {
  const n = Number(floors);
  if (!Number.isInteger(n) || n < 1 || n > 100) return [];
  const used = new Set(unitFloors.map((f) => Number(f)).filter((f) => Number.isInteger(f)));
  return Array.from({ length: n }, (_, i) => i + 1).filter((f) => !used.has(f));
}
