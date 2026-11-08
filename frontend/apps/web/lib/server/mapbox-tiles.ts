import "server-only";

/**
 * Mapbox map pictures (streets and satellite with street names). The key stays on the server (MAPBOX_ACCESS_TOKEN);
 * the map asks our own /api/mapbox-tiles, which passes each tile on. When Mapbox turns the key down (no permission
 * yet, or the monthly limit is used up) the map is sent to the free pictures instead, so it never goes blank.
 */
export const MAPBOX_STYLES = {
  streets: "mapbox/streets-v12",
  satellite: "mapbox/satellite-streets-v12",
} as const;
export type MapboxStyle = keyof typeof MAPBOX_STYLES;

/** Set after Mapbox refuses the key; tiles go straight to the free pictures until then. */
let refusedUntil = 0;

export function mapboxToken() {
  return process.env.MAPBOX_ACCESS_TOKEN || null;
}

export function mapboxRefused() {
  return refusedUntil > Date.now();
}

/** Mapbox said no to the key: try again in ten minutes rather than on every tile. */
export function markMapboxRefused() {
  refusedUntil = Date.now() + 10 * 60_000;
}

export function mapboxTileUrl(style: MapboxStyle, z: number, x: number, y: number, token: string) {
  return `https://api.mapbox.com/styles/v1/${MAPBOX_STYLES[style]}/tiles/256/${z}/${x}/${y}@2x?access_token=${encodeURIComponent(token)}`;
}

/** The free pictures the map used before Mapbox (MapTiler when there is a key, else OpenStreetMap / Esri). */
export function fallbackTileUrl(style: MapboxStyle, z: number, x: number, y: number) {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (style === "streets")
    return key
      ? `https://api.maptiler.com/maps/streets-v2/256/${z}/${x}/${y}.png?key=${key}`
      : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  return key
    ? `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}
