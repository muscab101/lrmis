import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness + database reachability (used by uptime checks). */
export async function GET() {
  const started = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let database: "ok" | "down" | "unconfigured" = "unconfigured";
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/setup_status`, {
        method: "POST",
        headers: { apikey: key, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      database = res.ok ? "ok" : "down";
    } catch {
      database = "down";
    }
  }
  const ok = database === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", database, latencyMs: Date.now() - started, version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { status: ok ? 200 : 503 },
  );
}
