import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIp, agentKey } from "@/lib/server/print-agent";
import { createIsolatedClient } from "@/lib/supabase/admin";

const Body = z.object({
  /** Printer names on this computer. */
  printers: z.array(z.string().max(200)).max(200).optional(),
  /** What the network says is at the printer's IP address. */
  printer_mac: z.string().max(17).optional(),
});

/** The print program checks in and takes its next job. It signs in with the printer's own key; the database checks it. */
export async function POST(req: NextRequest) {
  const key = agentKey(req);
  if (!key) return NextResponse.json({ ok: false, error: "bad_key" }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const { data, error } = await createIsolatedClient().rpc("agent_claim_job", { p_key: key, p_ip: agentIp(req), p_info: body.data });
  if (error) return NextResponse.json({ ok: false, error: "server" }, { status: 502 });
  const out = data as { ok: boolean };
  return NextResponse.json(out, { status: out.ok ? 200 : 401, headers: { "cache-control": "no-store" } });
}
