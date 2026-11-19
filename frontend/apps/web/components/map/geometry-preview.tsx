"use client";

import { bbox as turfBbox } from "@turf/bbox";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { DhulkaMap, type DhulkaMapHandle } from "./dhulka-map";
import { PIN_COLOURS, type PinState } from "./style";

/** A map pin (like the house pins on the main map) in the colour of its state, as an element for a MapLibre marker. */
export function pinElement(state: PinState = "paid") {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg width="30" height="40" viewBox="0 0 48 64" style="display:block;filter:drop-shadow(0 1px 2px rgb(15 23 42 / .35))">
    <path d="M24 3C13.5 3 5 11.5 5 22c0 14 19 39 19 39s19-25 19-39C43 11.5 34.5 3 24 3z" fill="${PIN_COLOURS[state]}" stroke="#f8fafc" stroke-width="3"/>
    <circle cx="24" cy="22" r="7" fill="#f8fafc"/></svg>`;
  return el;
}

/**
 * Small read-only map of one geometry (a parcel or a survey boundary). With `pin`, the land shows as a map pin at its
 * middle instead of its outline, like on the main map.
 */
export function GeometryPreview({ geometry, className = "h-56", pin = false, pinState = "paid" }: { geometry: GeoJSON.Geometry; className?: string; pin?: boolean; pinState?: PinState }) {
  const ref = useRef<DhulkaMapHandle>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let marker: maplibregl.Marker | null = null;
    const show = () => {
      const box = turfBbox(geometry) as [number, number, number, number];
      if (pin) {
        const map = ref.current?.getMap();
        if (!map) return;
        ref.current?.setHighlight(null);
        marker = new maplibregl.Marker({ element: pinElement(pinState), anchor: "bottom" }).setLngLat([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]).addTo(map);
        ref.current?.fitBounds(box, 18);
      } else {
        ref.current?.setHighlight(geometry);
        ref.current?.fitBounds(box, 19);
      }
    };
    // The map is created in a child effect; wait for it, then for its style.
    const wait = () => {
      if (cancelled) return;
      const map = ref.current?.getMap();
      if (!map) {
        timer = setTimeout(wait, 100);
        return;
      }
      if (map.isStyleLoaded() && map.getSource("highlight")) show();
      else map.once("load", () => !cancelled && show());
    };
    wait();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      marker?.remove();
    };
  }, [geometry, pin, pinState]);
  return <DhulkaMap ref={ref} className={`overflow-hidden rounded-md border ${className}`} base="satellite" visible={{ facilities: false }} />;
}
