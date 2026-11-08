import { NextResponse, type NextRequest } from "next/server";
import { googleTilesKey, googleTilesSession } from "@/lib/server/google-tiles";
import { createClient } from "@/lib/supabase/server";

/**
 * One Google satellite tile for the map. Only for people signed in (Google charges per tile), and the key never leaves
 * the server. Nothing is stored: each tile is passed straight on, with Google's own caching rules.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const [zi, xi, yi] = [Number(z), Number(x), Number(y.replace(/\.(png|jpe?g)$/, ""))];
  if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 22 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) {
    return new NextResponse(null, { status: 400 });
  }
  const key = googleTilesKey();
  if (!key) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return new NextResponse(null, { status: 401 });

  const s = await googleTilesSession();
  if (!s) return new NextResponse(null, { status: 502 });
  const res = await fetch(
    `https://tile.googleapis.com/v1/2dtiles/${zi}/${xi}/${yi}?session=${encodeURIComponent(s.token)}&key=${encodeURIComponent(key)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return new NextResponse(null, { status: 204 });
  if (!res.ok || !res.body) return new NextResponse(null, { status: 502 });
  return new NextResponse(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": res.headers.get("cache-control") ?? "private, max-age=3600",
    },
  });
}
