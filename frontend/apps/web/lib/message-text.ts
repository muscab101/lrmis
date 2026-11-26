/** Placeholders a message can use; each owner gets their own values. */
export const PLACEHOLDERS = ["owner_name", "property_number", "district_name", "neighbourhood_name", "tax_amount", "outstanding_balance", "payment_deadline"] as const;

// The GSM 7-bit alphabet: anything outside it makes the whole SMS Unicode (70 characters a part instead of 160).
const GSM = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXT = new Set("^{}\\[~]|€");

/** How an SMS of this text is sent: characters, how many parts, and whether it is Unicode. */
export function smsParts(text: string) {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else unicode = true;
  }
  const length = unicode ? [...text].length : units;
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const parts = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  return { length, parts, unicode, perPart: parts > 1 ? multi : single };
}
