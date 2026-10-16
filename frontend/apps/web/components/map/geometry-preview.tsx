"use client";

import { bbox as turfBbox } from "@turf/bbox";
import { useEffect, useRef } from "react";
import { DhulkaMap, type DhulkaMapHandle } from "./dhulka-map";

/** Small read-only map that frames one geometry (a parcel or a survey boundary). */
export function GeometryPreview({ geometry, className = "h-56" }: { geometry: GeoJSON.Geometry; className?: string }) {
  const ref = useRef<DhulkaMapHandle>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      ref.current?.setHighlight(geometry);
      ref.current?.fitBounds(turfBbox(geometry) as [number, number, number, number], 19);
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
    };
  }, [geometry]);
  return <DhulkaMap ref={ref} className={`overflow-hidden rounded-md border ${className}`} base="satellite" visible={{ facilities: false }} />;
}
