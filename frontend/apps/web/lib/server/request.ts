import "server-only";
import { headers } from "next/headers";
import { cache } from "react";

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Request id (set by middleware, else one per request) + client IP, forwarded to Postgres for the audit log. */
export const requestContext = cache(async (): Promise<RequestContext> => {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    ip: h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
});

export function contextHeaders(ctx: RequestContext): Record<string, string> {
  const out: Record<string, string> = { "x-request-id": ctx.requestId };
  if (ctx.ip) out["x-client-ip"] = ctx.ip;
  if (ctx.userAgent) out["user-agent"] = ctx.userAgent.slice(0, 400);
  return out;
}
