import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentKey } from "@/lib/server/print-agent";
import { createIsolatedClient } from "@/lib/supabase/admin";

const Body = z.object({ job: z.uuid(), ok: z.boolean(), error: z.string().max(300).optional() });

/** The print program says how a job went. Only then does the document count as printed. */
export async function POST(req: NextRequest) {
  const key = agentKey(req);
  if (!key) return NextResponse.json({ ok: false, error: "bad_key" }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const { data, error } = await createIsolatedClient().rpc("agent_report_job", { p_key: key, p_job: body.data.job, p_ok: body.data.ok, p_error: body.data.error ?? null });
  if (error) return NextResponse.json({ ok: false, error: "server" }, { status: 502 });
  const out = data as { ok: boolean; error?: string };
  return NextResponse.json(out, { status: out.ok ? 200 : out.error === "bad_key" ? 401 : 404 });
}
