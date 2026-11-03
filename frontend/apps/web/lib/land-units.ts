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
