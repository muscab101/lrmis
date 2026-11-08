/**
 * A PUN as typed or read off paper, the way it is stored: capitals, no dashes, and without the "BN" that PUNs carried
 * until 2026-10-31 (an old certificate's BN34KRWJXL0107 finds 34KRWJXL0107). The one dash that stays is a flat's or
 * compound house's, after the land's whole PUN: 3441116-2.
 */
export function normalizePun(input: string): string {
  const pun = input.trim().toUpperCase();
  const dropBn = (v: string) => v.replace(/^BN(?=[0-9A-Z]{4})/, "");
  // Short PUNs (2026-11-07) can be as short as 4 characters: 3441712, a flat 3441718-1.
  // A land's PUN starts with its district number, so letters before a dash (HDN-01201) are an old PUN typed with a dash.
  const unit = /^(\d[0-9A-Z]{2,})-([0-9A-Z]{1,6})$/.exec(dropBn(pun));
  return unit ? `${unit[1]}-${unit[2]}` : dropBn(pun.replace(/-/g, ""));
}

/**
 * A PostgREST filter for a land by its PUN, the new short one or the one it had before 2026-11-07
 * (34KRWJXL0712 still finds 3441712). Use with .or(...); the PUN must already be normalised.
 */
export function punFilter(pun: string): string {
  return `pun.eq.${pun},pun_old.eq.${pun}`;
}
