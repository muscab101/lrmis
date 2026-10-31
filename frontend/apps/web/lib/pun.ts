/**
 * A PUN as typed or read off paper, the way it is stored: capitals, no dashes, and without the "BN" that PUNs carried
 * until 2026-10-31 (an old certificate's BN34KRWJXL0107 finds 34KRWJXL0107).
 */
export function normalizePun(input: string): string {
  return input.trim().toUpperCase().replace(/-/g, "").replace(/^BN(?=[0-9A-Z]{4})/, "");
}
