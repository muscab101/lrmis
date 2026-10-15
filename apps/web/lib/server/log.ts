import "server-only";

type Level = "info" | "warn" | "error";

/** Structured JSON logs (picked up by Vercel / Sentry). Always include the request id. */
export function log(level: Level, event: string, data: Record<string, unknown> & { requestId?: string }) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
