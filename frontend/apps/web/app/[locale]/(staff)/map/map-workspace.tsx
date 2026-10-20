"use client";

import { Button } from "@dhulka/ui/button";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Checkbox } from "@dhulka/ui/form-controls";
import { cn } from "@dhulka/ui/lib/cn";
import { Mono } from "@dhulka/ui/misc";
import type { MapGeoJSONFeature } from "maplibre-gl";
import { Layers, MapPinned, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { DhulkaMap, type DhulkaMapHandle, type MapView } from "@/components/map/dhulka-map";
import { districtColourFor, LAYER_MINZOOM, LEGEND, type BaseMap, type BoundaryLayer } from "@/components/map/style";
import { Link } from "@/i18n/navigation";
import { getGeometryAction, searchNeighbourhoodsAction } from "../locations/actions";

const PREFS_KEY = "dhulka.map.prefs";

interface Prefs {
  base: BaseMap;
  visible: Record<BoundaryLayer, boolean>;
}

const DEFAULT_PREFS: Prefs = {
  base: "streets",
  visible: { districts: true, sections: false, sectors: false, neighbourhoods: true, streets: true, facilities: true },
};

export function MapWorkspace({
  initialView,
  extent,
  canEditLocations,
  canViewParcels,
  districts,
}: {
  initialView: MapView | undefined;
  extent: [number, number, number, number] | null;
  canEditLocations: boolean;
  canViewParcels: boolean;
  districts: { id: string; code: string; name_so: string; name_en: string; has_geom: boolean | null }[];
}) {
  const t = useTranslations("map");
  const tc = useTranslations("common");
  const locale = useLocale();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<{ layer: string; props: Record<string, unknown> } | null>(null);
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(initialView?.zoom ?? 12);
  const [search, setSearch] = useState<ComboOption[]>([]);
  const [showParcels, setShowParcels] = useState(true);

  useEffect(() => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    const apply = () => {
      for (const id of ["parcels-fill", "parcels-line", "parcels-label"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showParcels ? "visible" : "none");
    };
    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
  }, [showParcels]);

  // Per-viewer convenience: remember base map + layers in this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREFS_KEY);
      if (saved) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(saved) as Prefs) });
    } catch {
      /* storage unavailable */
    }
  }, []);
  const updatePrefs = (next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // Keep the view in the URL (?c=lng,lat,zoom) without re-rendering the page.
  const onViewChange = useCallback((v: MapView) => {
    setZoom(v.zoom);
    const url = new URL(window.location.href);
    url.searchParams.set("c", `${v.center[0].toFixed(5)},${v.center[1].toFixed(5)},${v.zoom.toFixed(2)}`);
    window.history.replaceState(null, "", url);
  }, []);

  const onFeatureClick = useCallback((f: MapGeoJSONFeature | null, lngLat: { lng: number; lat: number }) => {
    setCursor(lngLat);
    setSelected(f ? { layer: f.sourceLayer ?? f.layer.id, props: f.properties } : null);
  }, []);

  const searchNeighbourhoods = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchNeighbourhoodsAction({ q, districtId: null });
      if (!res.ok) return [];
      return res.data.map((n) => ({
        value: n.id,
        label: `${locale === "so" ? n.name_so : n.name_en} · ${n.district_name_so}`,
        hint: `${n.district_code}-${n.code}${n.has_geom ? "" : " ·" + t("notMapped")}`,
      }));
    },
    [locale, t],
  );

  async function zoomTo(level: "neighbourhoods" | "districts", id: string, colour?: string) {
    const res = await getGeometryAction({ level, id });
    if (res.ok && res.data) {
      mapRef.current?.setHighlight(res.data.geometry, colour);
      mapRef.current?.fitBounds(res.data.bbox);
    }
  }

  const name = (p: Record<string, unknown>) => String((locale === "so" ? p.name_so : p.name_en) || p.name_so || "");

  return (
    <div className="relative -mx-4 -my-8 h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-10">
      <DhulkaMap
        ref={mapRef}
        className="absolute inset-0"
        initialView={initialView}
        initialBounds={extent}
        base={prefs.base}
        visible={prefs.visible}
        onFeatureClick={onFeatureClick}
        onViewChange={onViewChange}
        parcels={canViewParcels}
      />

      {/* Search */}
      <div className="absolute start-3 top-3 z-10 w-[min(360px,calc(100%-5rem))] rounded-md border bg-card shadow-lg">
        <AsyncCombobox
          search={searchNeighbourhoods}
          value={search}
          onChange={(v) => {
            setSearch(v);
            if (v[0]) void zoomTo("neighbourhoods", v[0].value);
          }}
          placeholder={t("searchPlaceholder")}
          searchPlaceholder={tc("search")}
          emptyText={tc("noResults")}
        />
      </div>

      {/* Layers */}
      <div className="absolute end-3 top-3 z-10 flex flex-col items-end gap-2">
        <Button variant="outline" size="icon" className="bg-card shadow-lg" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} aria-label={t("layers")}>
          <Layers aria-hidden />
        </Button>
        {panelOpen && (
          <div className="w-64 rounded-md border bg-card p-4 shadow-lg">
            <div className="label-caps mb-2 text-muted-foreground">{t("baseMap")}</div>
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border p-1">
              {(["streets", "satellite"] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => updatePrefs({ ...prefs, base: b })}
                  className={cn("rounded-sm px-2 py-1.5 text-xs font-medium", prefs.base === b ? "bg-ink text-ink-foreground" : "hover:bg-muted")}
                  aria-pressed={prefs.base === b}
                >
                  {t(`base_${b}`)}
                </button>
              ))}
            </div>
            <div className="label-caps mb-2 text-muted-foreground">{t("layers")}</div>
            <ul className="space-y-2">
              {LEGEND.map(({ layer, swatch, kind }) => (
                <li key={layer}>
                  <label className="flex items-center gap-2.5 text-sm">
                    <Checkbox
                      checked={prefs.visible[layer]}
                      onCheckedChange={(v) => updatePrefs({ ...prefs, visible: { ...prefs.visible, [layer]: v === true } })}
                    />
                    <Swatch colour={swatch} kind={kind} />
                    <span className="flex-1">{t(`layer_${layer}`)}</span>
                    {zoom < LAYER_MINZOOM[layer] && <span className="text-[10px] text-muted-foreground">{t("zoomIn")}</span>}
                  </label>
                </li>
              ))}
              {canViewParcels && (
                <li>
                  <label className="flex items-center gap-2.5 text-sm">
                    <Checkbox checked={showParcels} onCheckedChange={(v) => setShowParcels(v === true)} />
                    <Swatch colour="#15803d" kind="fill" />
                    <span className="flex-1">{t("layer_parcels")}</span>
                    {zoom < 13 && <span className="text-[10px] text-muted-foreground">{t("zoomIn")}</span>}
                  </label>
                </li>
              )}
            </ul>
            {districts.length > 0 && (
              <>
                <div className="label-caps mt-4 mb-2 text-muted-foreground">
                  {t("layer_districts")} ({districts.length})
                </div>
                <ul className="-mx-1 max-h-64 space-y-0.5 overflow-y-auto">
                  {districts.map((d) => {
                    const colour = districtColourFor(d.name_so, d.name_en);
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          disabled={!d.has_geom}
                          onClick={() => void zoomTo("districts", d.id, colour)}
                          className="flex w-full items-center gap-2.5 rounded-sm px-1 py-1 text-start text-sm hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                        >
                          <span className="size-3 shrink-0 rounded-sm border" style={{ background: colour, borderColor: colour }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{name(d)}</span>
                          {d.has_geom ? <Mono className="text-[10px] text-muted-foreground">{d.code}</Mono> : <span className="text-[10px] text-muted-foreground">{t("noBoundary")}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Selected feature */}
      {selected && (
        <aside className="absolute inset-x-3 bottom-12 z-10 rounded-md border bg-card p-4 shadow-lg sm:start-auto sm:end-3 sm:w-80" aria-live="polite">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="label-caps text-flag">{t(`layer_${selected.layer as BoundaryLayer}`)}</div>
              <div className="text-base font-semibold">{name(selected.props)}</div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setSelected(null)} aria-label={tc("close")}>
              <X aria-hidden />
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {selected.props.code !== undefined && (
              <>
                <dt className="text-muted-foreground">{t("code")}</dt>
                <dd>
                  <Mono>
                    {selected.props.district_code ? `${String(selected.props.district_code)}-` : ""}
                    {String(selected.props.code)}
                  </Mono>
                </dd>
              </>
            )}
            {selected.props.district_name_so !== undefined && (
              <>
                <dt className="text-muted-foreground">{t("district")}</dt>
                <dd>{String(selected.props.district_name_so)}</dd>
              </>
            )}
            {selected.props.capacity !== undefined && selected.props.capacity !== null && (
              <>
                <dt className="text-muted-foreground">{t("capacity")}</dt>
                <dd className="tabular">{String(selected.props.capacity)}</dd>
              </>
            )}
            {selected.props.kind !== undefined && (
              <>
                <dt className="text-muted-foreground">{t("kind")}</dt>
                <dd>{t(`facility_${String(selected.props.kind)}`)}</dd>
              </>
            )}
          </dl>
          {selected.layer === "parcels" && (
            <div className="mt-2 space-y-3 text-sm">
              <p>
                <Mono>{String(selected.props.pun ?? t("noPun"))}</Mono> · {t(`parcel_${String(selected.props.status)}`)}
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/parcels/${String(selected.props.id)}`}>{t("openParcel")}</Link>
              </Button>
            </div>
          )}
          {selected.layer === "districts" && (
            <div className="mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void zoomTo("districts", String(selected.props.id), districtColourFor(String(selected.props.name_so ?? ""), String(selected.props.name_en ?? "")))}
              >
                <MapPinned aria-hidden />
                {t("zoomTo")}
              </Button>
            </div>
          )}
          {selected.layer === "neighbourhoods" && (
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void zoomTo("neighbourhoods", String(selected.props.id))}>
                <MapPinned aria-hidden />
                {t("zoomTo")}
              </Button>
              {canEditLocations && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/locations?level=neighbourhoods&q=${encodeURIComponent(String(selected.props.code))}&district=${String(selected.props.district_id)}`}>
                    {t("openInLocations")}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </aside>
      )}

      {/* Coordinates */}
      {cursor && (
        <div className="absolute start-1/2 bottom-3 z-10 -translate-x-1/2 rounded-sm bg-ink/85 px-2 py-1 font-mono text-[11px] text-ink-foreground">
          {cursor.lat.toFixed(6)}, {cursor.lng.toFixed(6)} · z{zoom.toFixed(1)}
        </div>
      )}

      {!extent && (
        <div className="absolute inset-x-3 top-16 z-10 mx-auto max-w-md rounded-md border border-s-[3px] border-s-warning bg-card px-4 py-3 text-sm shadow-lg">
          {t("noBoundaries")}
        </div>
      )}
    </div>
  );
}

function Swatch({ colour, kind }: { colour: string; kind: "line" | "fill" | "dashed" | "dot" }) {
  if (kind === "dot") return <span className="size-2.5 rounded-full border border-white" style={{ background: colour }} aria-hidden />;
  if (kind === "fill") return <span className="h-3 w-4 border" style={{ background: `${colour}33`, borderColor: colour }} aria-hidden />;
  return (
    <span
      className="h-0 w-4"
      style={{ borderTop: `2px ${kind === "dashed" ? "dashed" : "solid"} ${colour}` }}
      aria-hidden
    />
  );
}
