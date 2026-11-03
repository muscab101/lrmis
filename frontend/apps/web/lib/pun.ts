/**
 * A PUN as typed or read off paper, the way it is stored: capitals, no dashes, and without the "BN" that PUNs carried
 * until 2026-10-31 (an old certificate's BN34KRWJXL0107 finds 34KRWJXL0107). The one dash that stays is a flat's or
 * compound house's, after the land's whole PUN: 34KRWJXL0116-02.
 */
export function normalizePun(input: string): string {
  const pun = input.trim().toUpperCase();
  const dropBn = (v: string) => v.replace(/^BN(?=[0-9A-Z]{4})/, "");
  const unit = /^([0-9A-Z]{6,})-([0-9A-Z]{1,6})$/.exec(pun);
  return unit ? `${dropBn(unit[1]!)}-${unit[2]}` : dropBn(pun.replace(/-/g, ""));
}
