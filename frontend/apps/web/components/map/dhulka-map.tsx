"use client";

import maplibregl, { type Map as MlMap, type MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLocale } from "next-intl";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BOUNDARY_LAYERS, buildStyle, DEFAULT_VIEW, LAYER_IDS, PIN_OWING, PIN_PAID, type BaseMap, type BoundaryLayer } from "./style";

export interface MapView {
  center: [number, number];
  zoom: number;
}

export interface DhulkaMapHandle {
  fitBounds: (bbox: [number, number, number, number], maxZoom?: number) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  /** Draw one shape on top; `colour` defaults to the brand blue (e.g. a level colour from LEVEL_COLOURS). */
  setHighlight: (geometry: GeoJSON.Geometry | null, colour?: string) => void;
  getMap: () => MlMap | null;
}

interface Props {
  className?: string;
  initialView?: MapView | undefined;
  /** Fit here on load when no initialView is given. */
  initialBounds?: [number, number, number, number] | null | undefined;
  base?: BaseMap;
  visible?: Partial<Record<BoundaryLayer, boolean>>;
  /** Called with the top feature under the click (neighbourhood, facility …) or null. */
  onFeatureClick?: (feature: MapGeoJSONFeature | null, lngLat: { lng: number; lat: number }) => void;
  onViewChange?: (view: MapView) => void;
  interactive?: boolean;
  /** Staff maps also show parcels (tiles honour the user's districts). */
  parcels?: boolean;
}

const CLICKABLE = ["parcel-pins", "facilities-circle", "parcels-fill", "neighbourhoods-fill"];

/** The pin drawn on registered houses: a coloured map pin with a white dot, at twice the size for sharp screens. */
function housePin(colour: string): { width: number; height: number; data: Uint8Array } | null {
  const w = 48;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.fillStyle = colour;
  c.strokeStyle = "#ffffff";
  c.lineWidth = 3;
  c.beginPath();
  c.arc(w / 2, 22, 19, Math.PI, 0);
  c.bezierCurveTo(w / 2 + 19, 36, w / 2 + 6, 48, w / 2, h - 3);
  c.bezierCurveTo(w / 2 - 6, 48, w / 2 - 19, 36, w / 2 - 19, 22);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(w / 2, 22, 7, 0, Math.PI * 2);
  c.fill();
  return { width: w, height: h, data: new Uint8Array(c.getImageData(0, 0, w, h).data.buffer) };
}

/** MapLibre map with Dhulka base maps and PostGIS boundary tiles. */
export const DhulkaMap = forwardRef<DhulkaMapHandle, Props>(function DhulkaMap(
  { className, initialView, initialBounds, base = "streets", visible, onFeatureClick, onViewChange, interactive = true, parcels = false },
  ref,
) {
  const locale = useLocale() as "so" | "en";
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  const callbacks = useRef({ onFeatureClick, onViewChange });
  callbacks.current = { onFeatureClick, onViewChange };

  useImperativeHandle(ref, () => ({
    fitBounds: (bbox, maxZoom = 17) =>
      map.current?.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 48, maxZoom, duration: 600 },
      ),
    flyTo: (center, zoom = 16) => map.current?.flyTo({ center, zoom }),
    setHighlight: (geometry, colour) => {
      const m = map.current;
      if (m?.getLayer("highlight-fill")) {
        m.setPaintProperty("highlight-fill", "fill-color", colour ?? "#4189dd");
        m.setPaintProperty("highlight-line", "line-color", colour ?? "#4189dd");
      }
      const src = m?.getSource("highlight") as maplibregl.GeoJSONSource | undefined;
      src?.setData(geometry ? { type: "Feature", properties: {}, geometry } : { type: "FeatureCollection", features: [] });
    },
    getMap: () => map.current,
  }));

  // Create once.
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(window.location.origin, locale, { parcels }),
      center: initialView?.center ?? DEFAULT_VIEW.center,
      zoom: initialView?.zoom ?? DEFAULT_VIEW.zoom,
      interactive,
      attributionControl: { compact: true },
      maxBounds: [
        [38, -4],
        [54, 14],
      ],
    });
    map.current = m;
    if (interactive) {
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "bottom-right");
    }

    m.on("load", () => {
      loaded.current = true;
      if (!initialView && initialBounds) {
        m.fitBounds(
          [
            [initialBounds[0], initialBounds[1]],
            [initialBounds[2], initialBounds[3]],
          ],
          { padding: 40, duration: 0, maxZoom: 15 },
        );
      }
    });

    m.on("styleimagemissing", (e) => {
      const colour = e.id === "house-pin-paid" ? PIN_PAID : e.id === "house-pin-owing" ? PIN_OWING : null;
      if (!colour || m.hasImage(e.id)) return;
      const img = housePin(colour);
      if (img) m.addImage(e.id, img, { pixelRatio: 2 });
    });
    m.on("mouseenter", "parcel-pins", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcel-pins", () => (m.getCanvas().style.cursor = ""));

    let hovered: string | number | undefined;
    m.on("mousemove", "neighbourhoods-fill", (e) => {
      m.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (hovered !== undefined) m.setFeatureState({ source: "neighbourhoods", sourceLayer: "neighbourhoods", id: hovered }, { hover: false });
      hovered = f?.id;
      if (hovered !== undefined) m.setFeatureState({ source: "neighbourhoods", sourceLayer: "neighbourhoods", id: hovered }, { hover: true });
    });
    m.on("mouseleave", "neighbourhoods-fill", () => {
      m.getCanvas().style.cursor = "";
      if (hovered !== undefined) m.setFeatureState({ source: "neighbourhoods", sourceLayer: "neighbourhoods", id: hovered }, { hover: false });
      hovered = undefined;
    });
    m.on("click", (e) => {
      const layers = CLICKABLE.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, "visibility") !== "none");
      const feature = m.queryRenderedFeatures(e.point, { layers })[0] ?? null;
      callbacks.current.onFeatureClick?.(feature, e.lngLat);
    });
    m.on("moveend", () => {
      const c = m.getCenter();
      callbacks.current.onViewChange?.({ center: [c.lng, c.lat], zoom: m.getZoom() });
    });

    return () => {
      loaded.current = false;
      m.remove();
      map.current = null;
    };
    // Style depends on locale (and the parcels option); the map is recreated when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, parcels]);

  // Base map + layer visibility (applied once the style is ready).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      m.setLayoutProperty("base-streets", "visibility", base === "streets" ? "visible" : "none");
      m.setLayoutProperty("base-satellite", "visibility", base === "satellite" ? "visible" : "none");
      for (const layer of BOUNDARY_LAYERS) {
        const on = visible?.[layer] ?? true;
        for (const id of LAYER_IDS[layer]) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      }
    };
    if (loaded.current) apply();
    else m.once("load", apply);
  }, [base, visible]);


  // MapLibre's CSS sets `.maplibregl-map { position: relative }`, so it gets its own inner
  // element; the wrapper keeps whatever positioning the caller gives it.
  return (
    <div className={className}>
      <div ref={container} className="h-full w-full" />
    </div>
  );
});
