/**
 * The house number as shown everywhere in the system: the neighbourhood, then the house number — "KRWJXL01 07",
 * "KRWJXL03 11A", "KRWJXL01 11-1". A number already written with a neighbourhood code ("KRWJXL0101") is shown as it is.
 */
export function fullHouseNo(neighbourhoodCode: string | null | undefined, houseNo: string | null | undefined): string | null {
  const no = houseNo?.trim();
  if (!no) return null;
  const code = neighbourhoodCode?.trim();
  if (!code || no.toUpperCase().startsWith(code.toUpperCase()) || /^[A-Za-z]{4,}\d/.test(no)) return no;
  return `${code} ${no}`;
}
