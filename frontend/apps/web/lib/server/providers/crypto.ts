import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacHex(secret: string, data: string) {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}
