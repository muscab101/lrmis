/**
 * Whether a property type is a block of flats, so the land form asks for the flat number too.
 * Types are made by admins (Admin → Property types): the built-in one is "apartment", and any
 * type whose name says apartment or flat counts as well.
 */
export function isApartmentType(code: string | null | undefined, types: { code: string; name_en: string }[] = []): boolean {
  if (!code) return false;
  const name = types.find((t) => t.code === code)?.name_en ?? "";
  return /apartment|flat/i.test(`${code} ${name}`);
}
