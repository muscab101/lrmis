import { NextResponse, type NextRequest } from "next/server";
import {
  fallbackTileUrl,
  MAPBOX_STYLES,
  type MapboxStyle,
  mapboxRefused,
  mapboxTileUrl,
  mapboxToken,
  markMapboxRefused,
} from "@/lib/server/mapbox-tiles";
import { createClient } from "@/lib/supabase/server";

/**
 * One Mapbox tile for the map (streets or satellite). Only signed-in people get Mapbox (it is paid per tile beyond the
 * free amount) and the key never leaves the server. Anyone else, or any tile Mapbox refuses, is sent to the free
 * pictures so the map always shows something.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ style: string; z: string; x: string; y: string }> },
) {
  const { style, z, x, y } = await params;
  const [zi, xi, yi] = [Number(z), Number(x), Number(y.replace(/\.(png|jpe?g)$/, ""))];
  if (
    !(style in MAPBOX_STYLES) ||
    ![zi, xi, yi].every(Number.isInteger) ||
    zi < 0 ||
    zi > 22 ||
    xi < 0 ||
    yi < 0 ||
    xi >= 2 ** zi ||
    yi >= 2 ** zi
  ) {
    return new NextResponse(null, { status: 400 });
  }
  const s = style as MapboxStyle;
  const fallback = () => NextResponse.redirect(fallbackTileUrl(s, zi, xi, yi), 302);
  const token = mapboxToken();
  if (!token || mapboxRefused()) return fallback();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return fallback();

  const res = await fetch(mapboxTileUrl(s, zi, xi, yi, token), { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok || !res.body) {
    if (res && (res.status === 401 || res.status === 403 || res.status === 429)) markMapboxRefused();
    return fallback();
  }
  return new NextResponse(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "private, max-age=86400",
    },
  });
}
