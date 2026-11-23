"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { area as turfArea } from "@turf/area";
import maplibregl from "maplibre-gl";
import { Crosshair, Loader2, LocateFixed, Move, PenLine, RotateCcw, Scan } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { remapParcelAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormError } from "@/components/forms/form-error";
import { CornerPointer } from "@/components/map/corner-pointer";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";
import { pinElement } from "@/components/map/geometry-preview";
import type { PinState } from "@/components/map/style";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

type Polygon = GeoJSON.Polygon;

/** The outer ring of the land's current shape (a building's shape can come as a one-part MultiPolygon). */
const asPolygon = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon): Polygon =>
  g.type === "Polygon" ? g : { type: "Polygon", coordinates: g.coordinates[0]! };

/** A circle of `m` metres around a point, as a polygon (the GPS accuracy around "my location"). */
function circle(lng: number, lat: number, m: number): Polygon {
  const dLat = m / 111320;
  const dLng = m / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 41 }, (_, i) => {
    const a = (i / 40) * 2 * Math.PI;
    return [lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return { type: "Polygon", coordinates: [ring] };
}

/** The same shape, moved so its middle is at (lng, lat). */
function moveTo(shape: Polygon, lng: number, lat: number): Polygon {
  const ring = shape.coordinates[0]!.slice(0, -1);
  const cx = ring.reduce((s, c) => s + c[0]!, 0) / ring.length;
  const cy = ring.reduce((s, c) => s + c[1]!, 0) / ring.length;
  return { type: "Polygon", coordinates: shape.coordinates.map((r) => r.map((c) => [c[0]! + lng - cx, c[1]! + lat - cy])) };
}

/**
 * Remap: the land's shape as it is now (blue) and a copy to move (orange). Drag the copy to where the land really is
 * and fix its corners, or draw it again; then save with a reason. Only the drawing changes: the size and bills stay.
 */
export function RemapEditor({
  parcelId,
  current,
  recordedM2,
  placedByGuess,
  pinState,
  backTo,
  canCorners = false,
}: {
  parcelId: string;
  /** Where to go after saving (the remapping list it was opened from); the land's page otherwise. */
  backTo?: string;
  current: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  recordedM2: number | null;
  placedByGuess: boolean;
  /** The colour of this land's pin (paid, owing, not registered yet), as on its own page. */
  pinState: PinState;
  /** May draw the land by its 4 corners with the centre pointer (map.draw_corners). */
  canCorners?: boolean;
}) {
  const t = useTranslations("parcels.remap");
  const tm = useTranslations("map.corners");
  // 4-corner drawing with the centre pointer is open.
  const [cornering, setCornering] = useState(false);
  const format = useFormatter();
  const router = useRouter();
  const vm = useValidationMessage();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [shape, setShape] = useState<Polygon | null>(asPolygon(current));
  const [mode, setMode] = useState<"select" | "polygon">("select");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const m2 = (n: number) => `${format.number(n, { maximumFractionDigits: 1 })} m²`;
  // "My location": the phone's or computer's GPS, followed while this page is open.
  const [me, setMe] = useState<{ lng: number; lat: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const watch = useRef<number | null>(null);
  // The one pin on this map: this land, standing on the shape being saved (other land is not shown here).
  const pin = useRef<maplibregl.Marker | null>(null);
  const drawn = shape ? turfArea({ type: "Feature", geometry: shape, properties: {} }) : 0;

  /** Put a fresh copy of the current shape on the map, selected so it can be dragged at once. */
  const resetCopy = () => {
    const d = draw.current;
    if (!d) return;
    d.clear();
    const id = crypto.randomUUID();
    d.addFeatures([{ type: "Feature", id, geometry: asPolygon(current), properties: { mode: "polygon" } }]);
    d.setMode("select");
    d.selectFeature(id);
    setMode("select");
  };

  useEffect(() => {
    const map = mapRef.current?.getMap();
    const where = shape ?? asPolygon(current);
    const ring = where.coordinates[0]!.slice(0, -1);
    const at: [number, number] = [ring.reduce((s, c) => s + c[0]!, 0) / ring.length, ring.reduce((s, c) => s + c[1]!, 0) / ring.length];
    if (!map) return;
    if (!pin.current) pin.current = new maplibregl.Marker({ element: pinElement(pinState), anchor: "bottom" }).setLngLat(at).addTo(map);
    else pin.current.setLngLat(at);
  }, [shape, current, pinState]);
  useEffect(
    () => () => {
      pin.current?.remove();
      pin.current = null;
    },
    [],
  );

  /** Draw (or move) the blue dot and its accuracy circle. */
  const showMe = (p: { lng: number; lat: number; accuracy: number }) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: circle(p.lng, p.lat, Math.max(p.accuracy, 3)), properties: { kind: "accuracy" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { kind: "me" } },
      ],
    };
    const src = map.getSource("my-location") as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
    if (src?.setData) {
      src.setData(data);
      return;
    }
    map.addSource("my-location", { type: "geojson", data });
    map.addLayer({ id: "my-location-accuracy", type: "fill", source: "my-location", filter: ["==", ["get", "kind"], "accuracy"], paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 } });
    map.addLayer({
      id: "my-location-dot",
      type: "circle",
      source: "my-location",
      filter: ["==", ["get", "kind"], "me"],
      paint: { "circle-radius": 8, "circle-color": "#2563eb", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
    });
  };

  /** Start following the GPS; the first fix brings the map to it. */
  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast.error(t("noGps"));
      return;
    }
    if (me) {
      mapRef.current?.flyTo([me.lng, me.lat], 19);
      return;
    }
    setLocating(true);
    let first = true;
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lng: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy };
        setMe(p);
        setLocating(false);
        showMe(p);
        if (first) {
          first = false;
          mapRef.current?.flyTo([p.lng, p.lat], 19);
        }
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? t("gpsDenied") : t("gpsFailed"));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };
  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );

  /** Put the shape (as it is now, else the copy) where I am standing; then only its corners need fixing. */
  const moveHere = () => {
    const d = draw.current;
    if (!d || !me) return;
    const moved = moveTo(shape ?? asPolygon(current), me.lng, me.lat);
    d.clear();
    const id = crypto.randomUUID();
    d.addFeatures([{ type: "Feature", id, geometry: moved, properties: { mode: "polygon" } }]);
    d.setMode("select");
    d.selectFeature(id);
    setMode("select");
    setShape(moved);
  };

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const init = () => {
      const map = mapRef.current?.getMap();
      if (!map) {
        if (tries++ < 50 && !cancelled) setTimeout(init, 100);
        return;
      }
      const start = () => {
        if (cancelled) return;
        mapRef.current?.setHighlight(current);
        const ring = asPolygon(current).coordinates[0]!;
        const xs = ring.map((c) => c[0]!);
        const ys = ring.map((c) => c[1]!);
        // Land placed by guess: show the area around it, so the real place is easy to reach.
        mapRef.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], placedByGuess ? 17 : 20);
        const d = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map }),
          modes: [
            new TerraDrawPolygonMode({
              editable: true,
              styles: { fillColor: "#c2410c", fillOpacity: 0.2, outlineColor: "#c2410c", outlineWidth: 2 },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: {
                  feature: {
                    // The whole shape moves by dragging; its corners move on their own too.
                    draggable: true,
                    coordinates: { draggable: true, midpoints: true, deletable: true },
                  },
                },
              },
              styles: {
                selectedPolygonColor: "#c2410c",
                selectedPolygonFillOpacity: 0.25,
                selectedPolygonOutlineColor: "#c2410c",
                selectedPolygonOutlineWidth: 2.5,
              },
            }),
          ],
        });
        d.start();
        draw.current = d;
        d.on("change", () => {
          const f = d.getSnapshot().find((x) => x.geometry.type === "Polygon" && !x.properties?.currentlyDrawing);
          setShape(f ? (f.geometry as Polygon) : null);
        });
        d.on("finish", () => {
          // One shape: a new drawing replaces the copy.
          const feats = d.getSnapshot().filter((f) => f.geometry.type === "Polygon");
          if (feats.length > 1) d.removeFeatures(feats.slice(0, -1).map((f) => f.id!));
          d.setMode("select");
          setMode("select");
        });
        resetCopy();
      };
      if (map.loaded()) start();
      else map.once("load", start);
    };
    init();
    return () => {
      cancelled = true;
      try {
        draw.current?.stop();
      } catch {
        /* map gone */
      }
      draw.current = null;
    };
    // Mounts once per parcel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The 4 corners are in: they become the new shape, its corners still draggable. */
  const cornersDone = (p: Polygon, reordered: boolean) => {
    setCornering(false);
    const d = draw.current;
    if (!d) return;
    d.clear();
    const id = crypto.randomUUID();
    d.addFeatures([{ type: "Feature", id, geometry: p, properties: { mode: "polygon" } }]);
    d.setMode("select");
    d.selectFeature(id);
    setMode("select");
    setShape(p);
    if (reordered) toast.warning(tm("crossed"));
    else toast.success(tm("done"));
  };

  const drawNew = () => {
    draw.current?.clear();
    draw.current?.setMode("polygon");
    setShape(null);
    setMode("polygon");
  };

  async function save() {
    if (!shape) return;
    setBusy(true);
    setError(null);
    const r = await remapParcelAction({
      id: parcelId,
      geom: shape as { type: "Polygon"; coordinates: [number, number][][] },
      reason,
    });
    setBusy(false);
    if (r.ok) {
      toast.success(t("saved", { moved: format.number(r.data.moved_m) }));
      router.push(backTo ?? `/parcels/${parcelId}`);
    } else setError(r.error);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="relative">
        <DhulkaMap
          ref={mapRef}
          base="satellite"
          visible={{ facilities: false, streets: true }}
          className="h-[65vh] min-h-[440px] overflow-hidden rounded-lg border"
        />
        <div className="absolute start-3 top-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant={mode === "select" ? "default" : "outline"} className="bg-card" onClick={resetCopy}>
            <Move aria-hidden />
            {t("moveCopy")}
          </Button>
          <Button size="sm" variant={mode === "polygon" ? "default" : "outline"} className="bg-card" onClick={drawNew}>
            <PenLine aria-hidden />
            {t("drawNew")}
          </Button>
          {canCorners && (
            <Button
              size="sm"
              variant={cornering ? "default" : "outline"}
              className="bg-card"
              aria-pressed={cornering}
              onClick={() => {
                if (!cornering) {
                  draw.current?.setMode("select");
                  setMode("select");
                }
                setCornering(!cornering);
              }}
            >
              <Scan aria-hidden />
              {tm("button")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="bg-card" onClick={resetCopy} aria-label={t("startAgain")}>
            <RotateCcw aria-hidden />
          </Button>
        </div>
        {cornering && <CornerPointer getMap={() => mapRef.current?.getMap()} colour="#c2410c" onDone={cornersDone} onCancel={() => setCornering(false)} />}
        <div className="absolute end-3 bottom-8 flex flex-col items-end gap-1.5">
          {me && (
            <Button size="sm" variant="outline" className="bg-card" onClick={moveHere}>
              <Crosshair aria-hidden />
              {t("moveHere")}
            </Button>
          )}
          <Button size="sm" className="shadow-md" onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" aria-hidden /> : <LocateFixed aria-hidden />}
            {t("myLocation")}
          </Button>
          {me && (
            <span className="bg-card/90 text-muted-foreground rounded px-2 py-0.5 text-[11px] tabular-nums">
              {t("accuracy", { m: format.number(Math.round(me.accuracy)) })}
            </span>
          )}
        </div>
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("help")}</p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {placedByGuess && <Alert tone="warning" title={t("guessTitle")}>{t("guessBody")}</Alert>}
          <dl className="grid grid-cols-[1fr_auto] gap-y-1">
            <dt className="text-muted-foreground">{t("recorded")}</dt>
            <dd className="tabular-nums">{recordedM2 ? m2(recordedM2) : "—"}</dd>
            <dt className="text-muted-foreground">{t("drawn")}</dt>
            <dd className="tabular-nums">{shape ? m2(drawn) : "—"}</dd>
          </dl>
          <p className="text-muted-foreground text-xs">{t("sizeStays")}</p>
          <Field
            id="remap-reason"
            label={t("reason")}
            error={error?.fieldErrors?.reason?.[0] ? vm(error.fieldErrors.reason[0]) : undefined}
            required
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("reasonHint")} />
          </Field>
          {error && <FormError error={error} />}
          <Button className="w-full" disabled={busy || !shape || reason.trim().length < 5} onClick={save}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
