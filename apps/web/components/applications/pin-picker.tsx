"use client";

import { Button } from "@dhulka/ui/button";
import maplibregl from "maplibre-gl";
import { Crosshair, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";

export interface Pin {
  lon: number;
  lat: number;
  accuracy?: number | null;
}

interface Props {
  value: Pin | null;
  onChange: (pin: Pin) => void;
  disabled?: boolean;
  /** Optional outline to show (the chosen neighbourhood). */
  outline?: GeoJSON.Geometry | null;
  outlineBbox?: [number, number, number, number] | null;
}

/** Drop a pin by clicking the map, or use the device GPS. */
export function PinPicker({ value, onChange, disabled = false, outline, outlineBbox }: Props) {
  const t = useTranslations("applications.pin");
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
        onChange({ lon: p.lng, lat: p.lat, accuracy: null });
      });
    } else {
      marker.current.setLngLat([value.lon, value.lat]);
    }
  }, [value, disabled, onChange]);

  useEffect(() => {
    const h = setTimeout(() => {
      mapRef.current?.setHighlight(outline ?? null);
      if (value) mapRef.current?.flyTo([value.lon, value.lat], 17);
      else if (outlineBbox) mapRef.current?.fitBounds(outlineBbox, 16);
    }, 300);
    return () => clearTimeout(h);
    // Only when the outline changes; following the pin would fight the user's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline, outlineBbox]);

  function useGps() {
    if (!navigator.geolocation) return setGpsError(t("gpsUnavailable"));
    setLocating(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const pin = { lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: Math.round(pos.coords.accuracy) };
        onChange(pin);
        mapRef.current?.flyTo([pin.lon, pin.lat], 18);
      },
      () => {
        setLocating(false);
        setGpsError(t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative h-72 overflow-hidden rounded-md border sm:h-80">
        <DhulkaMap
          ref={mapRef}
          className="absolute inset-0"
          initialView={value ? { center: [value.lon, value.lat], zoom: 17 } : undefined}
          visible={{ facilities: false, streets: false }}
          onFeatureClick={(_, lngLat) => !disabled && onChange({ lon: lngLat.lng, lat: lngLat.lat, accuracy: null })}
        />
        {!value && !disabled && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-sm bg-card/95 px-3 py-2 text-xs shadow">{t("hint")}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={useGps} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" aria-hidden /> : <Crosshair aria-hidden />}
            {t("useGps")}
          </Button>
        )}
        {value && (
          <span className="font-mono">
            {value.lat.toFixed(6)}, {value.lon.toFixed(6)}
            {value.accuracy ? ` · ±${value.accuracy} m` : ""}
          </span>
        )}
        {gpsError && <span className="text-danger">{gpsError}</span>}
      </div>
    </div>
  );
}
