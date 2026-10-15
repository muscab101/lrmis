/** Password rules (§3.1): at least 10 characters and not found in a known breach list. */

export const PASSWORD_MIN_LENGTH = 10;
export const LOCKOUT_MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type PasswordProblem = "too_short" | "too_long" | "too_simple";

export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push("too_short");
  if (password.length > 128) problems.push("too_long");
  // Reject passwords made of a single repeated character or a single character class
  // shorter than 14 chars — cheap protection on top of the breach check.
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (/^(.)\1+$/.test(password) || (classes < 2 && password.length < 14)) {
    problems.push("too_simple");
  }
  return problems;
}

const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";

/** Strong random password for "Generate" in the admin user form. Uses Web Crypto. */
export function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += GENERATED_ALPHABET[b % GENERATED_ALPHABET.length];
  // Guarantee every character class so the policy above always passes.
  return passwordProblems(out).length === 0 ? out : generatePassword(length);
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Have I Been Pwned range check (k-anonymity: only the first 5 hash chars leave the server).
 * Returns `null` when the service can't be reached — callers decide whether to fail open.
 */
export async function isPasswordBreached(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return null;
  }
}
