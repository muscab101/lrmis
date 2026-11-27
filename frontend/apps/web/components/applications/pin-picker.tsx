"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import type { GeoJSONSource, MapLibreEvent, Map as MlMap } from "maplibre-gl";
import { Building2, Crosshair, Loader2, RotateCcw, RotateCw, Scan, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BuildingOutline, buildingAtAction } from "@/app/[locale]/(staff)/parcels/actions";
import { addCornerLayers, CornerPointer, cornerFeatures } from "@/components/map/corner-pointer";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";

export interface Pin {
  lon: number;
  lat: number;
  accuracy?: number | null;
  /** "gps" from the device, "manual" when the map was moved under the pin. */
  method?: "gps" | "manual" | null;
}

/** GPS readings worse than this are flagged (matches the location.max_accuracy_m setting). */
export const GOOD_ACCURACY_M = 15;
const GPS_WAIT_MS = 25_000;

interface Props {
  value: Pin | null;
  onChange: (pin: Pin) => void;
  disabled?: boolean;
  /** Optional outline to show (the chosen neighbourhood). */
  outline?: GeoJSON.Geometry | null;
  outlineBbox?: [number, number, number, number] | null;
  /**
   * May give the land its shape (map.draw_corners): the roof under the pin, else a box of width × length around the
   * pin, or the 4 corners drawn by hand. The pin is always the middle of the shape.
   */
  corners?: boolean;
  /** The plot's width and length (m) from the form, for the box around the pin. */
  size?: { width: number; length: number } | null;
  /** The land's shape (null when there is none), so the land keeps it as its boundary. */
  onShape?: (shape: GeoJSON.Polygon | null) => void;
  /** A roof was found under the pin: its width and length (m), for the form to fill in. */
  onRoofSize?: (size: { width: number; length: number }) => void;
}

type Pt = [number, number];
const SHAPE_SRC = "pin-shape";

/** The middle of a shape (its centre of area), so the pin sits inside the land even when it is not a neat square. */
function middleOf(p: GeoJSON.Polygon): Pt {
  const ring = p.coordinates[0]!;
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i] as Pt;
    const [x1, y1] = ring[i + 1] as Pt;
    const c = x0 * y1 - x1 * y0;
    a += c;
    x += (x0 + x1) * c;
    y += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-14) {
    const pts = ring.slice(0, -1);
    return [pts.reduce((s, c) => s + c[0]!, 0) / pts.length, pts.reduce((s, c) => s + c[1]!, 0) / pts.length];
  }
  return [x / (3 * a), y / (3 * a)];
}

/** A width × length box around a middle point, turned by `angle` degrees (0 = width runs east–west). */
export function boxAround(centre: Pt, width: number, length: number, angle: number): GeoJSON.Polygon {
  const [lon, lat] = centre;
  const r = (angle * Math.PI) / 180;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const mLat = 110_540;
  const corner = (x: number, y: number): Pt => {
    const dx = x * Math.cos(r) - y * Math.sin(r);
    const dy = x * Math.sin(r) + y * Math.cos(r);
    return [+(lon + dx / mLon).toFixed(7), +(lat + dy / mLat).toFixed(7)];
  };
  const w = width / 2;
  const l = length / 2;
  const ring = [corner(-w, -l), corner(w, -l), corner(w, l), corner(-w, l)];
  return { type: "Polygon", coordinates: [[...ring, ring[0]!]] };
}

/** Is the point inside the shape (its outer ring)? */
function inside(pt: Pt, p: GeoJSON.Polygon): boolean {
  const ring = p.coordinates[0]!;
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Pt;
    const [xj, yj] = ring[j] as Pt;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The pin stays in the middle of the map: move the map until it sits on the house. With shapes on, the system looks for
 * the roof under the pin and moves the pin to that roof's middle; with no roof it draws a box of the plot's width ×
 * length around the pin, which can be turned to face the street. The 4 corners can still be drawn by hand.
 */
export function PinPicker({ value, onChange, disabled = false, outline, outlineBbox, corners = false, size = null, onShape, onRoofSize }: Props) {
  const t = useTranslations("applications.pin");
  const tm = useTranslations("map.corners");
  const format = useFormatter();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const [cornering, setCornering] = useState(false);
  // A shape drawn by hand from 4 corners: it wins over the roof and the box until the pin leaves it.
  const [drawn, setDrawn] = useState<GeoJSON.Polygon | null>(null);
  const [roof, setRoof] = useState<BuildingOutline | null>(null);
  const [looking, setLooking] = useState(false);
  const notThis = useRef(new Set<number>());
  const lastRoof = useRef<number | null>(null);
  const [angle, setAngle] = useState(0);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRoofSizeRef = useRef(onRoofSize);
  onRoofSizeRef.current = onRoofSize;

  const map = useCallback((): MlMap | null => mapRef.current?.getMap() ?? null, []);
  /** Move the map without it counting as the user moving the pin. */
  const moveTo = useCallback(
    (centre: Pt, zoom?: number) => map()?.easeTo({ center: centre, ...(zoom ? { zoom } : {}), duration: 400 }, { auto: true }),
    [map],
  );

  const box = useMemo(
    () => (value && size && size.width > 0 && size.length > 0 ? boxAround([value.lon, value.lat], size.width, size.length, angle) : null),
    [value, size, angle],
  );
  // The land is always drawn from the width and length typed in the form (or 4 corners drawn by hand). A roof found
  // under the pin only gives the middle, the direction and the first width and length.
  const shape: GeoJSON.Polygon | null = corners ? (drawn ?? box) : null;
  const shapeKind = !corners ? null : drawn ? "drawn" : box ? "box" : null;
  const onRoof = corners && !drawn && roof !== null;

  // The form keeps the shape as the land's boundary.
  const shapeKey = JSON.stringify(shape);
  useEffect(() => {
    onShape?.(shape);
    // Only when the shape itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  // Draw it on the map: the sides with their lengths, the corners numbered.
  useEffect(() => {
    const m = map();
    if (!m) return;
    const paint = () => {
      addCornerLayers(m, SHAPE_SRC, onRoof ? "#0f9d58" : "#1d5fc2");
      const pts = shape ? (shape.coordinates[0]!.slice(0, -1) as Pt[]) : [];
      (m.getSource(SHAPE_SRC) as GeoJSONSource | undefined)?.setData(cornerFeatures(pts, null, true));
    };
    if (m.isStyleLoaded()) paint();
    else m.once("load", paint);
    // Redraw only when the shape or its kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shapeKey, onRoof]);

  /** Look for the roof under the pin; found: the pin goes to its middle. */
  const lookup = useRef(0);
  const findRoof = useCallback(
    async (pt: Pt) => {
      if (!corners) return;
      const ticket = ++lookup.current;
      setLooking(true);
      const r = await buildingAtAction({ lon: pt[0], lat: pt[1] });
      if (ticket !== lookup.current) return;
      setLooking(false);
      const b = r.ok ? r.data : null;
      if (!b || notThis.current.has(b.id)) {
        setRoof(null);
        return;
      }
      setRoof(b);
      onChangeRef.current({ lon: b.centre[0], lat: b.centre[1], accuracy: null, method: "manual" });
      moveTo(b.centre);
      // A new roof: its size goes into the form (once, so the surveyor's own changes stay), and a box drawn later
      // faces the same way as the roof.
      if (lastRoof.current !== b.id) {
        lastRoof.current = b.id;
        if (b.width_m && b.length_m) onRoofSizeRef.current?.({ width: b.width_m, length: b.length_m });
        if (b.angle != null) setAngle(b.angle);
      }
    },
    [corners, moveTo],
  );

  // The user moved the map (or clicked a spot): the pin is where the middle of the map now is.
  useEffect(() => {
    let stopped = false;
    let m: MlMap | null = null;
    const moved = (e: MapLibreEvent & { auto?: boolean }) => {
      if (stopped || !m || disabled || cornering || e.auto) return;
      const c = m.getCenter();
      const pt: Pt = [c.lng, c.lat];
      onChangeRef.current({ lon: pt[0], lat: pt[1], accuracy: null, method: "manual" });
      setDrawn((d) => (d && !inside(pt, d) ? null : d));
      void findRoof(pt);
    };
    const wait = (tries: number) => {
      if (stopped) return;
      m = map();
      if (!m) return void (tries < 100 && setTimeout(() => wait(tries + 1), 100));
      m.on("moveend", moved);
    };
    wait(0);
    return () => {
      stopped = true;
      m?.off("moveend", moved);
    };
  }, [map, disabled, cornering, findRoof]);

  // Show the chosen neighbourhood and go to it (or to the pin), once the map has loaded.
  useEffect(() => {
    let cancelled = false;
    const show = () => {
      if (cancelled) return;
      mapRef.current?.setHighlight(outline ?? null);
      const m = map();
      if (value) moveTo([value.lon, value.lat], 18);
      else if (outlineBbox && m) m.fitBounds(outlineBbox, { maxZoom: 16, padding: 24, duration: 0 }, { auto: true });
    };
    const h = setTimeout(() => {
      show();
      map()?.once("load", show);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
    // Only when the outline changes; following the pin would fight the user's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline, outlineBbox]);

  /** The 4 corners are in: the pin goes to their middle. */
  function cornersDone(p: GeoJSON.Polygon, reordered: boolean) {
    setCornering(false);
    setDrawn(p);
    const [lon, lat] = middleOf(p);
    onChange({ lon, lat, accuracy: null, method: "manual" });
    moveTo([lon, lat]);
    if (reordered) toast.warning(tm("crossed"));
    else toast.success(tm("pinDone"));
  }

  // Keep reading the GPS until it is accurate enough (or the wait runs out), keeping the best fix.
  const watch = useRef<number | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const stopGps = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setLocating(false);
  };
  useEffect(() => () => stopGps(), []);

  function useGps() {
    if (!navigator.geolocation) return setGpsError(t("gpsUnavailable"));
    if (!window.isSecureContext) return setGpsError(t("gpsNeedsHttps"));
    setLocating(true);
    setGpsError(null);
    let best: GeolocationPosition | null = null;
    const started = Date.now();
    const accept = (pos: GeolocationPosition) => {
      const pin = { lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: Math.round(pos.coords.accuracy), method: "gps" as const };
      onChange(pin);
      setDrawn(null);
      moveTo([pin.lon, pin.lat], 18);
    };
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLive(Math.round(pos.coords.accuracy));
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos;
          accept(pos);
        }
        if (pos.coords.accuracy <= GOOD_ACCURACY_M || Date.now() - started > GPS_WAIT_MS) {
          stopGps();
          if (best) void findRoof([best.coords.longitude, best.coords.latitude]);
        }
      },
      () => {
        stopGps();
        setGpsError(best ? null : t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: GPS_WAIT_MS, maximumAge: 0 },
    );
    window.setTimeout(() => watch.current !== null && stopGps(), GPS_WAIT_MS + 1000);
  }

  const turn = (by: number) => setAngle((a) => (((a + by) % 180) + 180) % 180);

  return (
    <div className="space-y-2">
      <div className="relative h-80 overflow-hidden rounded-md border sm:h-96">
        <DhulkaMap
          ref={mapRef}
          className="absolute inset-0"
          initialView={value ? { center: [value.lon, value.lat], zoom: 18 } : undefined}
          base="satellite"
          visible={{ facilities: false, streets: false }}
          parcels
          // A click moves that spot to the middle, under the pin.
          onFeatureClick={(_, lngLat) => !disabled && !cornering && map()?.easeTo({ center: lngLat, duration: 300 })}
        />
        {/* The pin, always in the middle: its tip is the exact spot. */}
        {!cornering && (
          <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full" aria-hidden>
            <svg width="34" height="44" viewBox="0 0 34 44" className="drop-shadow-md">
              <path d="M17 43C17 43 32 26.5 32 16.5C32 8 25.3 1.5 17 1.5C8.7 1.5 2 8 2 16.5C2 26.5 17 43 17 43Z" fill={onRoof ? "#0f9d58" : "#4189dd"} stroke="#fff" strokeWidth="2.5" />
              <circle cx="17" cy="16.5" r="5.5" fill="#fff" />
            </svg>
          </div>
        )}
        {cornering && <CornerPointer getMap={map} onDone={cornersDone} onCancel={() => setCornering(false)} />}
        {!value && !disabled && !cornering && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-sm bg-card-solid/95 px-3 py-2 text-xs shadow">{t("hint")}</div>
        )}
        {looking && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-sm bg-card-solid/95 px-2 py-1 text-xs shadow">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("lookingRoof")}
          </div>
        )}
        {/* Turn the box to face the street. */}
        {shapeKind === "box" && !disabled && (
          <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md bg-card-solid/95 p-1 shadow">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("turnLeft")} title={t("turnLeft")} onClick={() => turn(-15)}>
              <RotateCcw aria-hidden />
            </Button>
            <input
              type="range"
              min={0}
              max={179}
              value={angle}
              aria-label={t("turn")}
              onChange={(e) => setAngle(Number(e.target.value))}
              className="w-28 accent-primary"
            />
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("turnRight")} title={t("turnRight")} onClick={() => turn(15)}>
              <RotateCw aria-hidden />
            </Button>
            <span className="w-9 text-center font-mono text-xs tabular-nums">{angle}°</span>
          </div>
        )}
      </div>

      {/* What the land's shape is now, and how to change it. */}
      {corners && !cornering && value && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          {onRoof && roof && (
            <>
              <Building2 className="size-4 text-success" aria-hidden />
              <span className="font-medium">{t("roofFound", { m2: format.number(roof.area_m2, { maximumFractionDigits: 0 }) })}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  notThis.current.add(roof.id);
                  setRoof(null);
                }}
              >
                <X aria-hidden />
                {t("notThisRoof")}
              </Button>
              <span className="ms-auto text-muted-foreground">{t("roofSource")}</span>
            </>
          )}
          {shapeKind === "box" && size && (
            <span className={onRoof ? "basis-full" : undefined}>{t("boxUsed", { w: format.number(size.width), l: format.number(size.length) })}</span>
          )}
          {shapeKind === "drawn" && <span>{tm("done")}</span>}
          {shapeKind === null && <span className="text-muted-foreground">{t("boxNeedsSize")}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={locating ? stopGps : useGps}>
            {locating ? <Loader2 className="animate-spin" aria-hidden /> : <Crosshair aria-hidden />}
            {locating ? t("gpsStop", { m: live ?? "…" }) : value?.method === "gps" ? t("gpsAgain") : t("useGps")}
          </Button>
        )}
        {/* For odd shapes: draw the 4 corners by hand. */}
        {corners && !disabled && !cornering && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              stopGps();
              setDrawn(null);
              setCornering(true);
            }}
          >
            <Scan aria-hidden />
            {drawn ? tm("again") : t("cornersInstead")}
          </Button>
        )}
        {value && (
          <span className="font-mono">
            {value.lat.toFixed(6)}, {value.lon.toFixed(6)}
            {value.accuracy ? ` · ±${value.accuracy} m` : ""}
          </span>
        )}
        {value?.method && <span className="rounded-sm bg-muted px-1.5 py-0.5">{value.method === "gps" ? t("methodGps") : t("methodManual")}</span>}
        {gpsError && <span className="text-danger">{gpsError}</span>}
      </div>
      {value?.method === "gps" && !locating && (value.accuracy ?? 0) > GOOD_ACCURACY_M && (
        <p role="alert" className="rounded-md border border-status-pending/40 bg-status-pending/10 px-3 py-2 text-xs">
          {t("lowAccuracy", { m: value.accuracy ?? 0, limit: GOOD_ACCURACY_M })}
        </p>
      )}
    </div>
  );
}
