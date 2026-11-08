import "server-only";

/**
 * Google satellite pictures for the map (Google Maps Platform, Map Tiles API).
 * The key stays on the server (GOOGLE_MAPS_API_KEY); the map asks our own /api/google-tiles, which passes each tile on.
 * A Map Tiles session lasts about two weeks; one is made when needed and reused until shortly before it ends.
 */
let session: { token: string; until: number; width: number } | null = null;
let making: Promise<{ token: string; until: number; width: number } | null> | null = null;

export function googleTilesKey() {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

export async function googleTilesSession() {
  const key = googleTilesKey();
  if (!key) return null;
  if (session && session.until > Date.now()) return session;
  making ??= (async () => {
    try {
      const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "SO", scale: "scaleFactor2x", highDpi: true }),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const s = (await res.json()) as { session: string; expiry: string; tileWidth: number };
      // Renew a day before Google ends it.
      session = { token: s.session, until: Number(s.expiry) * 1000 - 24 * 3600_000, width: s.tileWidth };
      return session;
    } catch {
      return null;
    } finally {
      making = null;
    }
  })();
  return making;
}
