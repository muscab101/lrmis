"use client";

import turfArea from "@turf/area";
import turfLength from "@turf/length";
import type { LocationLevel } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { cn } from "@dhulka/ui/lib/cn";
import { toast } from "@dhulka/ui/toaster";
import type { VectorTileSource } from "maplibre-gl";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { PenTool, Pentagon, Redo2, Ruler, Save, Spline, Trash2, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawModeUndoRedo,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  TerraDrawSessionUndoRedo,
  TerraDrawUndoRedoKeyboardShortcuts,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { DhulkaMapHandle } from "@/components/map/dhulka-map";
import { districtColourFor } from "@/components/map/style";
import { useRouter } from "@/i18n/navigation";
import { getGeometryAction, listChildrenAction, setGeometryAction } from "../locations/actions";

/** A boundary being edited on the map. */
export interface EditTarget {
  level: LocationLevel;
  id: string;
  name: string;
  colour: string;
  /** With no boundary yet: the places around it (nearest first) whose boundary or point frames the map to draw on. */
  frame?: { level: LocationLevel; id: string }[];
}

type Tool = "line" | "area" | "edit" | "pick";
type Polygon = GeoJSON.Polygon;

/** Area in words: m² for small areas, hectares and km² for big ones. */
export function formatArea(m2: number) {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString("en")} m²`;
  const ha = m2 / 10_000;
  const km2 = m2 / 1_000_000;
  return km2 >= 1 ? `${km2.toLocaleString("en", { maximumFractionDigits: 2 })} km² · ${Math.round(ha).toLocaleString("en")} ha` : `${ha.toLocaleString("en", { maximumFractionDigits: 2 })} ha`;
}
/** Length in words: metres, or km from 1 km. */
export function formatLength(km: number) {
  return km >= 1 ? `${km.toLocaleString("en", { maximumFractionDigits: 2 })} km` : `${Math.round(km * 1000).toLocaleString("en")} m`;
}
/** The area (m²) and edge length (km) of any polygon shape. */
export function measureShape(g: GeoJSON.Geometry) {
  const f = { type: "Feature" as const, properties: {}, geometry: g };
  return { m2: turfArea(f), km: turfLength(f as GeoJSON.Feature<GeoJSON.LineString>) };
}

// terra-draw refuses coordinates with too many decimals; 7 is about 1 cm.
const round = (p: Polygon): Polygon => ({ type: "Polygon", coordinates: p.coordinates.map((ring) => ring.map(([x, y]) => [Math.round(x! * 1e7) / 1e7, Math.round(y! * 1e7) / 1e7])) });

/**
 * Measure on the map (a distance along a line, or an area and its edge) and, for staff who manage locations, edit a
 * district's (or any location's) boundary by dragging its points. One drawing layer serves both, made when a tool opens.
 */
export function MapTools({
  mapRef,
  edit,
  onEditStart,
  onEditEnd,
  onActiveChange,
  canDraw,
  districts,
}: {
  mapRef: RefObject<DhulkaMapHandle | null>;
  edit: EditTarget | null;
  onEditStart: (target: EditTarget) => void;
  onEditEnd: () => void;
  onActiveChange: (active: boolean) => void;
  /** May draw and edit borders (locations.update). */
  canDraw: boolean;
  districts: { id: string; name_so: string; name_en: string }[];
}) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("map");
  const tc = useTranslations("common");
  const draw = useRef<TerraDraw | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [result, setResult] = useState<{ km: number; m2: number; shapes: number }>({ km: 0, m2: 0, shapes: 0 });
  const [saving, setSaving] = useState(false);
  // Undo / redo: a point while drawing, else the last change (a moved point, a closed shape, a clear).
  const [history, setHistory] = useState({ undo: false, redo: false });
  const syncHistory = useCallback(() => {
    const d = draw.current;
    setHistory(d ? { undo: d.canUndo(), redo: d.canRedo() } : { undo: false, redo: false });
  }, []);
  // A border drawn from nothing (the place has none yet).
  const [fresh, setFresh] = useState(false);
  // The place picked to draw: a district, one of its sections, a sector in it, or a neighbourhood in that.
  type Place = { id: string; code: string; name_so: string; name_en: string; has_geom: boolean };
  const [pick, setPick] = useState({ district: "", section: "", sector: "", neighbourhood: "" });
  const [sections, setSections] = useState<Place[]>([]);
  const [sectors, setSectors] = useState<Place[]>([]);
  const [hoods, setHoods] = useState<Place[]>([]);
  useEffect(() => {
    setSections([]);
    if (!pick.district) return;
    void listChildrenAction({ level: "sections", parentId: pick.district }).then((r) => r.ok && setSections(r.data));
  }, [pick.district]);
  useEffect(() => {
    setSectors([]);
    if (!pick.section) return;
    void listChildrenAction({ level: "sectors", parentId: pick.section }).then((r) => r.ok && setSectors(r.data));
  }, [pick.section]);
  // Loaded again each time the picker opens, so a border just saved shows its tick.
  useEffect(() => {
    setHoods([]);
    if (!pick.sector || tool !== "pick") return;
    void listChildrenAction({ level: "neighbourhoods", parentId: pick.sector }).then((r) => r.ok && setHoods(r.data));
  }, [pick.sector, tool]);
  const drawnMark = (x: Place) => (x.has_geom ? " ✓" : "");
  const nameOf = (x: { name_so: string; name_en: string }) => (locale === "so" ? x.name_so : x.name_en) || x.name_so;
  function startPicked() {
    const d = districts.find((x) => x.id === pick.district);
    if (!d) return;
    const sec = sections.find((x) => x.id === pick.section);
    const sect = sectors.find((x) => x.id === pick.sector);
    const hood = hoods.find((x) => x.id === pick.neighbourhood);
    const up = [
      ...(sect ? [{ level: "sectors" as const, id: sect.id }] : []),
      ...(sec ? [{ level: "sections" as const, id: sec.id }] : []),
      { level: "districts" as const, id: d.id },
    ];
    onEditStart(
      hood
        ? { level: "neighbourhoods", id: hood.id, name: `${hood.code} · ${nameOf(hood)}`, colour: "#2563eb", frame: up }
        : sect
          ? { level: "sectors", id: sect.id, name: `${sect.code} · ${nameOf(sect)}`, colour: "#15803d", frame: up.slice(1) }
          : sec
            ? { level: "sections", id: sec.id, name: `${nameOf(sec)} · ${nameOf(d)}`, colour: "#d97706", frame: up.slice(-1) }
            : { level: "districts", id: d.id, name: nameOf(d), colour: districtColourFor(d.name_so, d.name_en) },
    );
  }

  // Add up every finished (or being drawn) line and shape.
  const recount = useCallback(() => {
    const d = draw.current;
    if (!d) return;
    let km = 0;
    let m2 = 0;
    let shapes = 0;
    for (const f of d.getSnapshot()) {
      if (f.geometry.type === "LineString" || f.geometry.type === "Polygon") {
        const m = measureShape(f.geometry);
        km += m.km;
        if (f.geometry.type === "Polygon") m2 += m.m2;
        shapes++;
      }
    }
    setResult({ km, m2, shapes });
  }, []);

  const stop = useCallback(() => {
    draw.current?.stop();
    draw.current = null;
    setTool(null);
    setResult({ km: 0, m2: 0, shapes: 0 });
    setHistory({ undo: false, redo: false });
    onActiveChange(false);
  }, [onActiveChange]);

  const start = useCallback(
    (next: Tool, hex = "#f59e0b") => {
      const colour = hex as `#${string}`;
      const map = mapRef.current?.getMap();
      if (!map) return null;
      draw.current?.stop();
      const flags = { feature: { draggable: false, coordinates: { draggable: true, midpoints: true, deletable: true } } };
      const d = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        // Ctrl+Z / Cmd+Z undoes, Ctrl+Shift+Z redoes.
        undoRedo: { modeLevel: new TerraDrawModeUndoRedo(), sessionLevel: new TerraDrawSessionUndoRedo(), keyboardShortcuts: new TerraDrawUndoRedoKeyboardShortcuts() },
        modes: [
          new TerraDrawLineStringMode({ styles: { lineStringColor: colour, lineStringWidth: 3, closingPointColor: "#f8fafc", closingPointOutlineColor: colour } }),
          new TerraDrawPolygonMode({ styles: { fillColor: colour, fillOpacity: 0.18, outlineColor: colour, outlineWidth: 3, closingPointColor: "#f8fafc", closingPointOutlineColor: colour } }),
          new TerraDrawSelectMode({
            flags: { polygon: flags, linestring: flags },
            styles: { selectedPolygonColor: colour, selectedPolygonFillOpacity: 0.18, selectedPolygonOutlineColor: colour, selectedPolygonOutlineWidth: 3, selectedLineStringColor: colour, selectedLineStringWidth: 3 },
          }),
        ],
      });
      d.start();
      d.on("change", recount);
      d.on("history", syncHistory);
      draw.current = d;
      setTool(next);
      onActiveChange(true);
      if (next === "line") d.setMode("linestring");
      if (next === "area") d.setMode("polygon");
      return d;
    },
    [mapRef, onActiveChange, recount, syncHistory],
  );

  // A boundary to edit: load it, put each part on the map and make its points draggable.
  useEffect(() => {
    if (!edit) return;
    let live = true;
    void getGeometryAction({ level: edit.level, id: edit.id }).then((res) => {
      if (!live) return;
      const g = res.ok ? res.data?.geometry : null;
      const d = start("edit", edit.colour);
      if (!d) return onEditEnd();
      mapRef.current?.setHighlight(null);
      // A closed shape (a new part, or a drag) goes back to moving points.
      d.on("finish", (id) => {
        if (d.getMode() !== "polygon") return;
        d.setMode("select");
        d.selectFeature(id);
      });
      // No border yet: draw it from nothing; when a shape is closed its points can be dragged.
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
        setFresh(true);
        d.setMode("polygon");
        // Go to where it should be drawn: the nearest place around it that is on the map (its boundary or point).
        void (async () => {
          for (const f of edit.frame ?? []) {
            const r = await getGeometryAction(f);
            if (!live) return;
            if (r.ok && r.data) return mapRef.current?.fitBounds(r.data.bbox, 17);
          }
        })();
        return;
      }
      setFresh(false);
      const parts: Polygon[] = g.type === "Polygon" ? [g] : g.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
      d.addFeatures(parts.map((p) => ({ type: "Feature", id: crypto.randomUUID(), geometry: round(p), properties: { mode: "polygon" } }) as GeoJSONStoreFeatures));
      d.setMode("select");
      const first = d.getSnapshot()[0]?.id;
      if (first !== undefined) d.selectFeature(first);
      if (res.ok && res.data) mapRef.current?.fitBounds(res.data.bbox, 16);
      d.clearUndoRedoHistory();
      syncHistory();
      recount();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.level, edit?.id]);

  useEffect(() => () => draw.current?.stop(), []);

  const closeEdit = () => {
    stop();
    onEditEnd();
  };

  async function saveBoundary() {
    const d = draw.current;
    if (!d || !edit) return;
    const polys = d.getSnapshot().filter((f) => f.geometry.type === "Polygon" && !f.properties?.currentlyDrawing).map((f) => f.geometry as Polygon);
    if (polys.length === 0) return toast.error(t("editNoBoundary"));
    const geometry: GeoJSON.Geometry = polys.length === 1 ? polys[0]! : { type: "MultiPolygon", coordinates: polys.map((p) => p.coordinates) };
    setSaving(true);
    const res = await setGeometryAction({ level: edit.level, id: edit.id, geojson: JSON.stringify(geometry) });
    setSaving(false);
    if (!res.ok) {
      // A neighbourhood drawn in or over another one: say which.
      const detail = String(res.error.values?.detail ?? "");
      if (detail.startsWith("neighbourhood_overlap")) return toast.error(t("neighbourhoodOverlap", { code: detail.split(": ")[1] ?? "" }));
      return toast.error(t("editFailed"));
    }
    toast.success(t("boundarySaved", { name: edit.name }));
    // Load the level's map pictures again so the new boundary shows.
    const src = mapRef.current?.getMap()?.getSource(edit.level) as VectorTileSource | undefined;
    if (src?.setTiles) src.setTiles([`${window.location.origin}/api/tiles/${edit.level}/{z}/{x}/{y}?v=${Date.now()}`]);
    closeEdit();
    router.refresh();
  }

  const btn = (on: boolean) => cn("bg-card-solid shadow-sm", on && "border-primary text-primary");

  return (
    <>
      {/* The tool buttons, under the layers button. */}
      {tool !== "edit" && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="icon" className={btn(tool === "line")} onClick={() => (tool === "line" ? stop() : start("line"))} aria-pressed={tool === "line"} aria-label={t("measureDistance")} title={t("measureDistance")}>
            <Ruler aria-hidden />
          </Button>
          {canDraw && (
            <Button variant="outline" size="icon" className={btn(tool === "pick")} onClick={() => (tool === "pick" ? stop() : (stop(), setTool("pick"), onActiveChange(true)))} aria-pressed={tool === "pick"} aria-label={t("drawBorder")} title={t("drawBorder")}>
              <PenTool aria-hidden />
            </Button>
          )}
          <Button variant="outline" size="icon" className={btn(tool === "area")} onClick={() => (tool === "area" ? stop() : start("area"))} aria-pressed={tool === "area"} aria-label={t("measureArea")} title={t("measureArea")}>
            <Pentagon aria-hidden />
          </Button>
        </div>
      )}

      {tool === "pick" && (
        <div className="fixed inset-x-3 bottom-12 z-20 rounded-md border bg-card-solid p-4 shadow-sm sm:absolute sm:inset-x-auto sm:end-14 sm:top-0 sm:bottom-auto sm:w-72">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-base font-semibold">{t("drawBorder")}</div>
            <Button variant="ghost" size="icon-sm" onClick={stop} aria-label={tc("close")}>
              <X aria-hidden />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{t("drawBorderHint")}</p>
          <div className="space-y-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("district")}
              <NativeSelect value={pick.district} onChange={(e) => setPick({ district: e.target.value, section: "", sector: "", neighbourhood: "" })}>
                <option value="">{t("choose")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {nameOf(d)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("layer_sections")}
              <NativeSelect value={pick.section} disabled={!pick.district} onChange={(e) => setPick({ ...pick, section: e.target.value, sector: "", neighbourhood: "" })}>
                <option value="">{t("wholeDistrict")}</option>
                {sections.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {nameOf(x)}
                    {drawnMark(x)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("layer_sectors")}
              <NativeSelect value={pick.sector} disabled={!pick.section} onChange={(e) => setPick({ ...pick, sector: e.target.value, neighbourhood: "" })}>
                <option value="">{t("wholeSection")}</option>
                {sectors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {nameOf(x)}
                    {drawnMark(x)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("layer_neighbourhoods")}
              <NativeSelect value={pick.neighbourhood} disabled={!pick.sector} onChange={(e) => setPick({ ...pick, neighbourhood: e.target.value })}>
                <option value="">{t("wholeSector")}</option>
                {hoods.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {nameOf(x)}
                    {drawnMark(x)}
                  </option>
                ))}
              </NativeSelect>
              {hoods.length > 0 && (
                <span>{t("hoodsDrawn", { drawn: hoods.filter((x) => x.has_geom).length, total: hoods.length })}</span>
              )}
            </label>
          </div>
          <Button size="sm" className="mt-3" disabled={!pick.district} onClick={startPicked}>
            <PenTool aria-hidden />
            {t("startDrawing")}
          </Button>
        </div>
      )}

      {tool && tool !== "pick" && (
        <div className="fixed inset-x-3 bottom-12 z-20 rounded-md border bg-card-solid p-4 shadow-sm sm:absolute sm:inset-x-auto sm:end-14 sm:top-0 sm:bottom-auto sm:w-72" aria-live="polite">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="label-caps text-flag">{tool === "edit" ? t("editBoundary") : t("measure")}</div>
              <div className="text-base font-semibold">{tool === "edit" ? edit?.name : tool === "line" ? t("measureDistance") : t("measureArea")}</div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={tool === "edit" ? closeEdit : stop} aria-label={tc("close")}>
              <X aria-hidden />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{t(tool === "edit" && fresh ? "measureHint_draw" : `measureHint_${tool}`)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {tool === "line" ? (
              <>
                <dt className="text-muted-foreground">{t("distance")}</dt>
                <dd className="font-semibold tabular-nums">{formatLength(result.km)}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">{t("area")}</dt>
                <dd className="font-semibold tabular-nums">{formatArea(result.m2)}</dd>
                <dt className="text-muted-foreground">{t("perimeter")}</dt>
                <dd className="tabular-nums">{formatLength(result.km)}</dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!history.undo} onClick={() => (draw.current?.undo(), syncHistory(), recount())} title="Ctrl+Z">
              <Undo2 aria-hidden />
              {t("undo")}
            </Button>
            <Button size="sm" variant="outline" disabled={!history.redo} onClick={() => (draw.current?.redo(), syncHistory(), recount())} aria-label={t("redo")} title={`${t("redo")} (Ctrl+Shift+Z)`}>
              <Redo2 aria-hidden />
            </Button>
            {tool === "edit" && (
              <Button
                size="sm"
                variant="outline"
                className="text-danger"
                disabled={result.shapes === 0}
                onClick={() => {
                  const d = draw.current;
                  if (!d) return;
                  d.removeFeatures(d.getSnapshot().map((f) => f.id!));
                  d.setMode("polygon");
                  setFresh(true);
                  syncHistory();
                  recount();
                }}
              >
                <Trash2 aria-hidden />
                {t("clearAll")}
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {tool === "edit" ? (
              <>
                <Button size="sm" onClick={() => void saveBoundary()} disabled={saving}>
                  <Save aria-hidden />
                  {t("saveBoundary")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => draw.current?.setMode("polygon")} disabled={saving}>
                  <Pentagon aria-hidden />
                  {t("addPart")}
                </Button>
                <Button size="sm" variant="outline" onClick={closeEdit} disabled={saving}>
                  {tc("cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={result.shapes === 0} onClick={() => draw.current?.clear()}>
                  <Trash2 aria-hidden />
                  {t("measureClear")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => start(tool === "line" ? "area" : "line")}>
                  {tool === "line" ? <Pentagon aria-hidden /> : <Spline aria-hidden />}
                  {tool === "line" ? t("measureArea") : t("measureDistance")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
