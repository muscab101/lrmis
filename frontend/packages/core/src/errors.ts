/**
 * Error codes shared by Postgres RPCs, server actions and the UI.
 * SQL raises `raise exception 'PERMISSION_DENIED' using errcode = 'P0001'` and the server
 * maps the message to one of these codes; the UI translates `errors.<code>` (so + en).
 */
export const ERROR_CODES = [
  "UNKNOWN",
  "VALIDATION",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "MFA_REQUIRED",
  "REAUTH_REQUIRED",
  "REAUTH_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "DUPLICATE_SUBMISSION",
  "RATE_LIMITED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_SUSPENDED",
  "INVALID_CREDENTIALS",
  "PASSWORD_WEAK",
  "PASSWORD_BREACHED",
  "EMAIL_TAKEN",
  "PRIVILEGE_ESCALATION",
  "LAST_SUPER_ADMIN",
  "SELF_ACTION_FORBIDDEN",
  "PROTECTED_ROLE",
  "ROLE_IN_USE",
  "SYSTEM_ROLE",
  "HAS_RECORDS",
  "DISTRICT_OUT_OF_SCOPE",
  "SETUP_ALREADY_DONE",
  "GOOGLE_NO_STAFF_ACCOUNT",
  "MAKER_CHECKER",
  "SESSION_EXPIRED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

export interface AppError {
  code: ErrorCode;
  /** Correlates the UI message with the server log line. */
  requestId: string;
  /** Field-level messages keyed by form field (already translation keys or raw text). */
  fieldErrors?: Record<string, string[]>;
  /** Extra values interpolated into the translated message, e.g. `{ count: 3 }`. */
  values?: Record<string, string | number>;
}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: AppError };

/** Pull an error code out of a Postgres / PostgREST error message like "ROLE_IN_USE: 3 users". */
export function codeFromDbMessage(message: string | undefined | null): ErrorCode | null {
  if (!message) return null;
  const head = message.split(/[:\s]/, 1)[0] ?? "";
  if (isErrorCode(head)) return head;
  if (message.includes("duplicate key value")) return "CONFLICT";
  if (message.includes("row-level security")) return "PERMISSION_DENIED";
  return null;
}
