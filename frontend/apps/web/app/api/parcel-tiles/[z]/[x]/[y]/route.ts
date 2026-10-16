import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Parcel vector tiles for staff. Runs as the signed-in user: `public.parcel_tile` checks
 * map.view and only includes parcels in the user's districts. Never cached publicly.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const [zi, xi, yi] = [Number(z), Number(x), Number(y.replace(/\.(pbf|mvt)$/, ""))];
  if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 22 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) {
    return new NextResponse(null, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("parcel_tile", { p_z: zi, p_x: xi, p_y: yi });
  if (error) return new NextResponse(null, { status: error.code === "42501" ? 403 : 502 });
  const body = Buffer.from(String(data ?? "").replace(/^\\x/, ""), "hex");
  const headers = { "cache-control": "private, max-age=30" };
  if (body.byteLength === 0) return new NextResponse(null, { status: 204, headers });
  return new NextResponse(body, { headers: { ...headers, "content-type": "application/vnd.mapbox-vector-tile" } });
}
