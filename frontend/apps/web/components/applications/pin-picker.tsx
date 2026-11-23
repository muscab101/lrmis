"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { Crosshair, Loader2, Scan } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { addCornerLayers, CornerPointer, cornerFeatures } from "@/components/map/corner-pointer";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";

export interface Pin {
  lon: number;
  lat: number;
  accuracy?: number | null;
  /** "gps" from the device, "manual" when clicked or dragged on the map. */
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
  /** Offer 4-corner drawing (map.draw_corners): the pin then goes to the middle of the 4 corners. */
  corners?: boolean;
  /** The 4-corner shape drawn (null when cleared), so the land can keep it as its boundary. */
  onShape?: (shape: GeoJSON.Polygon | null) => void;
  /** The neighbourhood's own boundary: everything outside it is shaded, and the 4 corners must stay inside it. */
  boundary?: GeoJSON.Geometry | null;
}

const MASK_SRC = "pin-outside";

/** The whole world with the neighbourhood cut out: shaded, so only the neighbourhood stays clear. */
function outsideOf(b: GeoJSON.Geometry): GeoJSON.Feature | null {
  const polys = b.type === "Polygon" ? [b.coordinates] : b.type === "MultiPolygon" ? b.coordinates : [];
  if (!polys.length) return null;
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...polys.map((p) => p[0]!)] } };
}

const CORNERS_SRC = "pin-corners";

/** The middle of a shape (its centre of area), so the pin sits inside the land even when it is not a neat square. */
function middleOf(p: GeoJSON.Polygon): [number, number] {
  const ring = p.coordinates[0]!;
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i] as [number, number];
    const [x1, y1] = ring[i + 1] as [number, number];
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

/** Drop a pin by clicking the map, or use the device GPS. */
export function PinPicker({ value, onChange, disabled = false, outline, outlineBbox, corners = false, onShape, boundary = null }: Props) {
  const t = useTranslations("applications.pin");
  const tm = useTranslations("map.corners");
  // 4-corner drawing: the centre pointer is out; the last shape drawn stays on the map.
  const [cornering, setCornering] = useState(false);
  const [shape, setShape] = useState<GeoJSON.Polygon | null>(null);
  const mapRef = useRef<DhulkaMapHandle>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Keep the marker in sync with the value.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ color: "#4189dd", draggable: !disabled })
        .setLngLat([value.lon, value.lat])
        .addTo(map);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLngLat();
        onChange({ lon: p.lng, lat: p.lat, accuracy: null, method: "manual" });
      });
    } else {
      marker.current.setLngLat([value.lon, value.lat]);
    }
  }, [value, disabled, onChange]);

  // Show the chosen neighbourhood and go to it, once the map has loaded (it may still be loading on a fresh page).
  useEffect(() => {
    let cancelled = false;
    const show = () => {
      if (cancelled) return;
      mapRef.current?.setHighlight(outline ?? null);
      if (value) mapRef.current?.flyTo([value.lon, value.lat], 17);
      else if (outlineBbox) mapRef.current?.fitBounds(outlineBbox, 16);
    };
    // Go now, and again when the first load finishes in case the style wasn't ready yet.
    const h = setTimeout(() => {
      show();
      mapRef.current?.getMap()?.once("load", show);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
    // Only when the outline changes; following the pin would fight the user's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline, outlineBbox]);

  // The 4-corner shape on the map, under the pin: its 4 sides as lines, each with its length, and the corners numbered.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    addCornerLayers(map, CORNERS_SRC, "#1d5fc2");
    const corners = shape ? (shape.coordinates[0]!.slice(0, -1) as [number, number][]) : [];
    (map.getSource(CORNERS_SRC) as GeoJSONSource | undefined)?.setData(cornerFeatures(corners, null, true));
  }, [shape]);

  // Shade everything outside the neighbourhood (once the map has loaded).
  useEffect(() => {
    let cancelled = false;
    const paint = () => {
      const map = mapRef.current?.getMap();
      if (cancelled || !map) return;
      const mask = boundary ? outsideOf(boundary) : null;
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: mask ? [mask] : [] };
      const src = map.getSource(MASK_SRC) as GeoJSONSource | undefined;
      if (src) return void src.setData(data);
      map.addSource(MASK_SRC, { type: "geojson", data });
      map.addLayer({ id: `${MASK_SRC}-fill`, type: "fill", source: MASK_SRC, paint: { "fill-color": "#0f172a", "fill-opacity": 0.5 } });
    };
    const h = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      if (map.isStyleLoaded()) paint();
      else map.once("load", paint);
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [boundary]);

  /** The 4 corners are in: the pin goes to their middle. */
  function cornersDone(p: GeoJSON.Polygon, reordered: boolean) {
    setCornering(false);
    setShape(p);
    onShape?.(p);
    const [lon, lat] = middleOf(p);
    onChange({ lon, lat, accuracy: null, method: "manual" });
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
      mapRef.current?.flyTo([pin.lon, pin.lat], 18);
    };
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLive(Math.round(pos.coords.accuracy));
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos;
          accept(pos);
        }
        if (pos.coords.accuracy <= GOOD_ACCURACY_M || Date.now() - started > GPS_WAIT_MS) stopGps();
      },
      () => {
        stopGps();
        setGpsError(best ? null : t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: GPS_WAIT_MS, maximumAge: 0 },
    );
    window.setTimeout(() => watch.current !== null && stopGps(), GPS_WAIT_MS + 1000);
  }

  return (
    <div className="space-y-2">
      <div className="relative h-72 overflow-hidden rounded-md border sm:h-80">
        <DhulkaMap
          ref={mapRef}
          className="absolute inset-0"
          initialView={value ? { center: [value.lon, value.lat], zoom: 17 } : undefined}
          base="satellite"
          visible={{ facilities: false, streets: false }}
          parcels
          onFeatureClick={(_, lngLat) => !disabled && !cornering && onChange({ lon: lngLat.lng, lat: lngLat.lat, accuracy: null, method: "manual" })}
        />
        {cornering && <CornerPointer getMap={() => mapRef.current?.getMap()} inside={boundary} onDone={cornersDone} onCancel={() => setCornering(false)} />}
        {!value && !disabled && !cornering && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-sm bg-card-solid/95 px-3 py-2 text-xs shadow">{t("hint")}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={locating ? stopGps : useGps}>
            {locating ? <Loader2 className="animate-spin" aria-hidden /> : <Crosshair aria-hidden />}
            {locating ? t("gpsStop", { m: live ?? "…" }) : value?.method === "gps" ? t("gpsAgain") : t("useGps")}
          </Button>
        )}
        {corners && !disabled && (
          <Button
            type="button"
            variant={cornering ? "default" : "outline"}
            size="sm"
            aria-pressed={cornering}
            onClick={() => {
              if (!cornering) {
                stopGps();
                setShape(null);
                onShape?.(null);
              }
              setCornering(!cornering);
            }}
          >
            <Scan aria-hidden />
            {tm("button")}
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
