import { z } from "zod";
import { PASSWORD_MIN_LENGTH, passwordProblems } from "../password";

/**
 * Validation messages are translation keys under `validation.*` in messages/{so,en}.json,
 * so the same schema produces Somali or English text on the client and the server.
 */
export const uuid = z.uuid("validation.invalid");

/** Somali mobile numbers in E.164: +252 followed by 7–9 digits. Other countries allowed for diaspora. */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "validation.phone"));

export const optionalPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.union([z.literal(""), z.string().regex(/^\+[1-9]\d{7,14}$/, "validation.phone")]))
  .transform((v) => (v === "" ? null : v));

export const email = z.string().trim().toLowerCase().pipe(z.email("validation.email"));

export const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "validation.password_short")
  .max(128, "validation.password_long")
  .refine((v) => passwordProblems(v).length === 0, "validation.password_simple");

/** Client-generated key that makes a submit safe to repeat (double-click, retry). */
export const idempotencyKey = z.uuid("validation.invalid");

export const localeSchema = z.enum(["so", "en"]);
export type Locale = z.infer<typeof localeSchema>;
