"use client";

import { Button } from "@dhulka/ui/button";
import { polygon as turfPolygon } from "@turf/helpers";
import { kinks } from "@turf/kinks";
import { Plus, Undo2, X } from "lucide-react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

type Pt = [number, number];
const SRC = "corner-draft";
const LAYERS = [`${SRC}-fill`, `${SRC}-line`, `${SRC}-pts`];

/** Metres between two points (short distances, plain enough for a side of a plot). */
function metres(a: Pt, b: Pt) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6_371_000;
}

/** The 4 corners as a closed shape; corners given out of order (sides crossing) are put in order around the middle. */
function shapeOf(corners: Pt[]): { polygon: GeoJSON.Polygon; reordered: boolean } {
  const ring = [...corners, corners[0]!];
  if (kinks(turfPolygon([ring])).features.length === 0) return { polygon: { type: "Polygon", coordinates: [ring] }, reordered: false };
  const cx = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const cy = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  const sorted = [...corners].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  return { polygon: { type: "Polygon", coordinates: [[...sorted, sorted[0]!]] }, reordered: true };
}

/**
 * 4-corner drawing: a pointer stays in the middle of the map. Move the map until it sits on a corner of the land and
 * press Add corner; after the 4th corner the shape closes and is handed back. The sides drawn so far, and the side
 * to the pointer, show on the map while you work. Put it inside the map's (relatively positioned) box.
 */
export function CornerPointer({
  getMap,
  onDone,
  onCancel,
  colour = "#1d5fc2",
}: {
  getMap: () => MlMap | null | undefined;
  onDone: (shape: GeoJSON.Polygon, reordered: boolean) => void;
  onCancel: () => void;
  colour?: string;
}) {
  const t = useTranslations("map.corners");
  const format = useFormatter();
  const [corners, setCorners] = useState<Pt[]>([]);
  const [side, setSide] = useState(0);
  const cornersRef = useRef<Pt[]>([]);
  // The map is read through a ref, so a new getMap each render does not redraw the layers.
  const mapOf = useRef(getMap);
  useEffect(() => {
    mapOf.current = getMap;
  }, [getMap]);

  const centre = useCallback((): Pt | null => {
    const c = mapOf.current()?.getCenter();
    return c ? [c.lng, c.lat] : null;
  }, []);

  // Draw the corners so far, the sides between them and the side still open to the pointer.
  const paint = useCallback(() => {
    const map = mapOf.current();
    const src = map?.getSource(SRC) as GeoJSONSource | undefined;
    const here = centre();
    if (!map || !src || !here) return;
    const pts = cornersRef.current;
    const path = [...pts, here];
    const features: GeoJSON.Feature[] = pts.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }));
    if (path.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts.length >= 3 ? [...path, pts[0]!] : path }, properties: {} });
    if (path.length >= 3) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...path, path[0]!]] }, properties: {} });
    src.setData({ type: "FeatureCollection", features });
    setSide(pts.length ? metres(pts.at(-1)!, here) : 0);
  }, [centre]);

  useEffect(() => {
    const map = mapOf.current();
    if (!map) return;
    if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer(LAYERS[0]!)) map.addLayer({ id: LAYERS[0]!, type: "fill", source: SRC, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": colour, "fill-opacity": 0.15 } });
    if (!map.getLayer(LAYERS[1]!))
      map.addLayer({ id: LAYERS[1]!, type: "line", source: SRC, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": colour, "line-width": 2.5, "line-dasharray": [2, 1] } });
    if (!map.getLayer(LAYERS[2]!))
      map.addLayer({
        id: LAYERS[2]!,
        type: "circle",
        source: SRC,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 6, "circle-color": "#f8fafc", "circle-stroke-color": colour, "circle-stroke-width": 2.5 },
      });
    map.on("move", paint);
    paint();
    return () => {
      map.off("move", paint);
      try {
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        /* map already gone */
      }
    };
  }, [paint, colour]);

  useEffect(() => {
    cornersRef.current = corners;
    paint();
  }, [corners, paint]);

  function add() {
    const here = centre();
    if (!here) return;
    const next = [...corners, here];
    if (next.length < 4) return setCorners(next);
    const { polygon, reordered } = shapeOf(next);
    setCorners([]);
    onDone(polygon, reordered);
  }

  const n = corners.length + 1;
  return (
    <>
      {/* The pointer: always the middle of the map. */}
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" aria-hidden>
        <svg width="44" height="44" viewBox="0 0 44 44" className="drop-shadow-[0_0_2px_rgba(255,255,255,0.9)]">
          <circle cx="22" cy="22" r="9" fill="none" stroke={colour} strokeWidth="2.5" />
          <path d="M22 2v12M22 30v12M2 22h12M30 22h12" stroke={colour} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="22" cy="22" r="2" fill={colour} />
        </svg>
      </div>
      <div className="absolute inset-x-3 bottom-10 z-20 rounded-md border bg-card-solid p-3 text-sm shadow-sm sm:inset-x-auto sm:start-3 sm:w-80" aria-live="polite">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{t("title", { n })}</p>
          <Button size="icon-sm" variant="ghost" onClick={onCancel} aria-label={t("cancel")}>
            <X aria-hidden />
          </Button>
        </div>
        <p className="text-muted-foreground">{t("help", { n })}</p>
        {corners.length > 0 && <p className="mt-1 text-xs tabular-nums text-muted-foreground">{t("side", { m: format.number(side, { maximumFractionDigits: 1 }) })}</p>}
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={add}>
            <Plus aria-hidden />
            {t("add", { n })}
          </Button>
          {corners.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCorners(corners.slice(0, -1))}>
              <Undo2 aria-hidden />
              {t("undo")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
