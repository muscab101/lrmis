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

/** Metres between two points (short distances, plain enough for a side of a plot). */
function metres(a: Pt, b: Pt) {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6_371_000;
}

const fmtM = (m: number) => `${m.toLocaleString("en", { maximumFractionDigits: 1 })} m`;
const f = (kind: string, geometry: GeoJSON.Geometry, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", geometry, properties: { kind, ...props } });

/**
 * The corners joined by lines: solid sides between the corners placed, a dashed side still open to the pointer (and
 * back to corner 1 once there are 3), each corner numbered and each solid side with its length. `closed` joins the
 * last corner back to the first with a solid side (the finished shape).
 */
export function cornerFeatures(corners: Pt[], here: Pt | null, closed = false): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const ring = closed && corners.length >= 3 ? [...corners, corners[0]!] : corners;
  const outline = here && !closed ? [...corners, here] : corners;
  if (outline.length >= 3) features.push(f("fill", { type: "Polygon", coordinates: [[...outline, outline[0]!]] }));
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    features.push(f("side", { type: "LineString", coordinates: [a, b] }));
    features.push(f("length", { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }, { label: fmtM(metres(a, b)) }));
  }
  if (here && !closed && corners.length > 0) {
    features.push(f("open", { type: "LineString", coordinates: [corners.at(-1)!, here] }));
    if (corners.length >= 3) features.push(f("open", { type: "LineString", coordinates: [here, corners[0]!] }));
  }
  corners.forEach((c, i) => features.push(f("corner", { type: "Point", coordinates: c }, { n: String(i + 1) })));
  return { type: "FeatureCollection", features };
}

/** Put the layers that draw cornerFeatures on the map (once per source). */
export function addCornerLayers(map: MlMap, src: string, colour: string) {
  if (!map.getSource(src)) map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const kind = (k: string) => ["==", ["get", "kind"], k] as ["==", ["get", string], string];
  const add = (layer: Parameters<MlMap["addLayer"]>[0]) => !map.getLayer(layer.id) && map.addLayer(layer);
  add({ id: `${src}-fill`, type: "fill", source: src, filter: kind("fill"), paint: { "fill-color": colour, "fill-opacity": 0.15 } });
  add({ id: `${src}-side-halo`, type: "line", source: src, filter: kind("side"), paint: { "line-color": "#f8fafc", "line-width": 6 } });
  add({ id: `${src}-side`, type: "line", source: src, filter: kind("side"), paint: { "line-color": colour, "line-width": 3.5 } });
  add({ id: `${src}-open`, type: "line", source: src, filter: kind("open"), paint: { "line-color": colour, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
  add({ id: `${src}-corner`, type: "circle", source: src, filter: kind("corner"), paint: { "circle-radius": 9, "circle-color": colour, "circle-stroke-color": "#f8fafc", "circle-stroke-width": 2 } });
  add({
    id: `${src}-corner-n`,
    type: "symbol",
    source: src,
    filter: kind("corner"),
    layout: { "text-field": ["get", "n"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-allow-overlap": true },
    paint: { "text-color": "#f8fafc" },
  });
  add({
    id: `${src}-length`,
    type: "symbol",
    source: src,
    filter: kind("length"),
    layout: { "text-field": ["get", "label"], "text-font": ["Open Sans Semibold"], "text-size": 12, "text-allow-overlap": true },
    paint: { "text-color": "#0f172a", "text-halo-color": "#f8fafc", "text-halo-width": 2 },
  });
}

/** Take those layers off again. */
export function removeCornerLayers(map: MlMap, src: string) {
  try {
    for (const l of map.getStyle()?.layers ?? []) if (l.id.startsWith(`${src}-`)) map.removeLayer(l.id);
    if (map.getSource(src)) map.removeSource(src);
  } catch {
    /* map already gone */
  }
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
    src.setData(cornerFeatures(pts, here));
    setSide(pts.length ? metres(pts.at(-1)!, here) : 0);
  }, [centre]);

  useEffect(() => {
    const map = mapOf.current();
    if (!map) return;
    addCornerLayers(map, SRC, colour);
    map.on("move", paint);
    paint();
    return () => {
      map.off("move", paint);
      removeCornerLayers(map, SRC);
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
          <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label={t("cancel")}>
            <X aria-hidden />
          </Button>
        </div>
        <p className="text-muted-foreground">{t("help", { n })}</p>
        {corners.length > 0 && <p className="mt-1 text-xs tabular-nums text-muted-foreground">{t("side", { m: format.number(side, { maximumFractionDigits: 1 }) })}</p>}
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" onClick={add}>
            <Plus aria-hidden />
            {t("add", { n })}
          </Button>
          {corners.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCorners(corners.slice(0, -1))}>
              <Undo2 aria-hidden />
              {t("undo")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
