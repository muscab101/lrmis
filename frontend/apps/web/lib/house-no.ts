/**
 * The full house number, as written everywhere in the system: the neighbourhood code, then the house (or flat) number,
 * e.g. "KRWJXL01 14". A number already written with a neighbourhood code (older entries like "KRWJXL0101") is shown
 * as it is.
 */
export function fullHouseNo(neighbourhoodCode: string | null | undefined, houseNo: string | null | undefined): string | null {
  const no = houseNo?.trim();
  if (!no) return null;
  const code = neighbourhoodCode?.trim();
  // Already written with a neighbourhood code (its own, or an older entry with another one, e.g. "KRWJXL0101").
  if (!code || no.toUpperCase().startsWith(code.toUpperCase()) || /^[A-Za-z]{4,}\d/.test(no)) return no;
  return `${code} ${no}`;
}
