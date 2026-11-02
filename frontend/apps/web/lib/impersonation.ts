/** Test login: a signed cookie saying which super admin is signed in as which user. Works in the middleware and the server. */
export const IMPERSONATION_COOKIE = "dhulka_testing_as";
export const IMPERSONATION_SECONDS = 2 * 60 * 60;

export interface Impersonation {
  admin: string;
  target: string;
  /** Seconds since 1970. */
  exp: number;
}

async function key(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`impersonation:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sealImpersonation(v: Impersonation, secret: string): Promise<string> {
  const payload = `${v.admin}.${v.target}.${v.exp}`;
  const sig = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return `${payload}.${toHex(sig)}`;
}

/** The cookie's content, or null when it is missing, forged or past its time. */
export async function openImpersonation(value: string | undefined, secret: string | undefined): Promise<Impersonation | null> {
  if (!value || !secret) return null;
  const [admin, target, exp, sig] = value.split(".");
  if (!admin || !target || !exp || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const bytes = new Uint8Array(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  const ok = await crypto.subtle.verify("HMAC", await key(secret), bytes, new TextEncoder().encode(`${admin}.${target}.${exp}`));
  if (!ok || Number(exp) < Date.now() / 1000) return null;
  return { admin, target, exp: Number(exp) };
}
