/**
 * Somali mobile-money wallets reachable through WaafiPay, recognised from the number's prefix
 * (+252 then two digits). Used to tell the payer which wallet will get the payment prompt.
 * Unknown prefixes still go to WaafiPay, which decides; we only label what we recognise.
 */
export type Wallet = "evc_plus" | "zaad" | "sahal" | "edahab";

const PREFIXES: Record<string, Wallet> = {
  "61": "evc_plus", // Hormuud
  "77": "evc_plus", // Hormuud
  "63": "zaad", // Telesom (Somaliland)
  "90": "sahal", // Golis (Puntland)
  "62": "edahab", // Somtel
  "65": "edahab", // Somtel
};

export const WALLET_NAMES: Record<Wallet, string> = { evc_plus: "EVC Plus", zaad: "Zaad", sahal: "Sahal", edahab: "eDahab" };

export function detectWallet(phone: string): Wallet | null {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("252") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (local.length !== 9) return null;
  return PREFIXES[local.slice(0, 2)] ?? null;
}
