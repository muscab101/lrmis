"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { area as turfArea } from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import { kinks } from "@turf/kinks";
import { length as turfLength } from "@turf/length";
import { ArrowRight, Camera, Check, Footprints, Layers, Loader2, MousePointer2, PenLine, Scan, Trash2, Undo2, Upload } from "lucide-react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import {
  gisReviewAction,
  photoUrlAction,
  saveSurveyAction,
  submitSurveyAction,
  uploadSurveyPhotoAction,
} from "@/app/[locale]/(staff)/surveys/actions";
import { FormError } from "@/components/forms/form-error";
import { CornerPointer } from "@/components/map/corner-pointer";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";
import { pinElement } from "@/components/map/geometry-preview";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { SurveyDetail } from "@/lib/server/surveys";

type Polygon = GeoJSON.Polygon;
type Method = "drawn" | "gps_walk" | "imported";

interface Props {
  survey: SurveyDetail;
  outline: { geometry: GeoJSON.Geometry; bbox: [number, number, number, number] } | null;
  /** The assigned surveyor working on an open task. */
  canEdit: boolean;
  /** GIS officer resolving an overlap. */
  canReview: boolean;
  /** May draw the land by its 4 corners with the centre pointer (map.draw_corners). */
  canCorners?: boolean;
}

const SNAP_PX = 12;
const BUILDING_TYPES = ["none", "house", "apartment", "shop", "warehouse", "mixed", "other"] as const;
const CONDITIONS = ["good", "fair", "poor", "ruin"] as const;

function measure(p: Polygon | null) {
  if (!p) return { area: null, perimeter: null, selfIntersects: false };
  const f = turfPolygon(p.coordinates);
  return {
    area: turfArea(f),
    perimeter: turfLength({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.coordinates[0]! } }, { units: "meters" }),
    selfIntersects: kinks(f).features.length > 0,
  };
}

/** The server takes plain [lon, lat] pairs (no altitude), rounded to ~1 mm. */
function toWire(p: Polygon) {
  const r = (n: number) => Math.round(n * 1e8) / 1e8;
  return { type: "Polygon" as const, coordinates: p.coordinates.map((ring) => ring.map((c) => [r(c[0]!), r(c[1]!)] as [number, number])) };
}

/** Snap to the corners of parcels already on the map, so neighbouring plots share boundaries. */
function parcelSnapper(map: MlMap) {
  return (event: { containerX: number; containerY: number }) => {
    if (!map.getLayer("parcels-line")) return undefined;
    const box: [[number, number], [number, number]] = [
      [event.containerX - SNAP_PX, event.containerY - SNAP_PX],
      [event.containerX + SNAP_PX, event.containerY + SNAP_PX],
    ];
    let best: [number, number] | undefined;
    let bestD = SNAP_PX;
    for (const f of map.queryRenderedFeatures(box, { layers: ["parcels-line"] })) {
      const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.flat() : [];
      for (const ring of rings) {
        for (const c of ring) {
          const pt = map.project(c as [number, number]);
          const d = Math.hypot(pt.x - event.containerX, pt.y - event.containerY);
          if (d < bestD) {
            bestD = d;
            best = [c[0]!, c[1]!];
          }
        }
      }
    }
    return best;
  };
}

export function SurveyWorkspace({ survey, outline, canEdit, canReview, canCorners = false }: Props) {
  const t = useTranslations("surveys");
  const tm = useTranslations("map.corners");
  const tc = useTranslations("common");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const draw = useRef<TerraDraw | null>(null);
  const editable = canEdit || canReview;

  const [polygon, setPolygon] = useState<Polygon | null>(survey.geom);
  const [mode, setMode] = useState<"select" | "polygon">("select");
  const [method, setMethod] = useState<Method>(survey.method ?? "drawn");
  const [accuracy, setAccuracy] = useState<number | null>(survey.accuracy_m != null ? Number(survey.accuracy_m) : null);
  const [walk, setWalk] = useState<{ points: [number, number][]; worst: number } | null>(null);
  const [locating, setLocating] = useState(false);
  // 4-corner drawing with the centre pointer is open.
  const [cornering, setCornering] = useState(false);
  const [neighbours, setNeighbours] = useState({ north: "", east: "", south: "", west: "", ...survey.neighbours });
  const [building, setBuilding] = useState({ type: "none", floors: null as number | null, use: "", condition: "", ...survey.building });
  const [notes, setNotes] = useState(survey.notes ?? "");
  const [base, setBase] = useState<"streets" | "satellite">("satellite");
  const [dirty, setDirty] = useState(false);
  const [geomDirty, setGeomDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [overlaps, setOverlaps] = useState(survey.overlap_list);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [review, setReview] = useState<"accept" | "return" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const m = measure(polygon);
  // Compare the drawn area with the declared width × length (warn above 20 %, location.area_tolerance_pct).
  const declared = survey.application?.plot_width_m && survey.application?.plot_length_m ? Number(survey.application.plot_width_m) * Number(survey.application.plot_length_m) : null;
  const areaGapPct = declared && m.area ? Math.round(((m.area - declared) / declared) * 100) : null;

  // ---- Terra Draw on the map ------------------------------------------------
  const putPolygon = useCallback((p: Polygon | null) => {
    const d = draw.current;
    if (!d) return;
    d.clear();
    if (p) d.addFeatures([{ type: "Feature", id: crypto.randomUUID(), geometry: p, properties: { mode: "polygon" } } as GeoJSONStoreFeatures]);
  }, []);

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
        const snapping = { toCoordinate: true, toCustom: parcelSnapper(map) };
        const d = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map }),
          modes: [
            new TerraDrawPolygonMode({
              snapping,
              editable: true,
              styles: { fillColor: "#1d5fc2", fillOpacity: 0.2, outlineColor: "#1d5fc2", outlineWidth: 2.5, closingPointColor: "#f8fafc", closingPointOutlineColor: "#1d5fc2" },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: {
                  feature: {
                    draggable: false,
                    coordinates: { draggable: editable, midpoints: editable, deletable: editable, snappable: { toCoordinate: true, toCustom: parcelSnapper(map) } },
                  },
                },
              },
              styles: { selectedPolygonColor: "#1d5fc2", selectedPolygonFillOpacity: 0.2, selectedPolygonOutlineColor: "#1d5fc2", selectedPolygonOutlineWidth: 2.5 },
            }),
          ],
        });
        d.start();
        draw.current = d;
        d.setMode("select");
        if (survey.geom) {
          putPolygon(survey.geom);
          const id = d.getSnapshot()[0]?.id;
          if (id !== undefined && editable) d.selectFeature(id);
        }
        d.on("change", () => {
          const feats = d.getSnapshot().filter((f) => f.geometry.type === "Polygon" && !f.properties?.currentlyDrawing);
          // One parcel per survey: drawing a new shape replaces the old one.
          if (feats.length > 1) d.removeFeatures(feats.slice(0, -1).map((f) => f.id!));
          const last = feats.at(-1);
          setPolygon(last ? (last.geometry as Polygon) : null);
        });
        d.on("finish", () => {
          setGeomDirty(true);
          setDirty(true);
          setMode("select");
          d.setMode("select");
          const id = d.getSnapshot().at(-1)?.id;
          if (id !== undefined) d.selectFeature(id);
        });
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
        /* map already removed */
      }
      draw.current = null;
    };
    // The workspace mounts once per survey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vertex drags in select mode only fire "change"; mark them as edits.
  const lastGeom = useRef(JSON.stringify(survey.geom));
  useEffect(() => {
    const s = JSON.stringify(polygon);
    if (s !== lastGeom.current) {
      lastGeom.current = s;
      setGeomDirty(true);
      setDirty(true);
    }
  }, [polygon]);

  // Frame the work: the drawn parcel, else the neighbourhood, else the pin (once the map has loaded). A pin marks the
  // survey's place — the application's pin, else the middle of the drawn land — and the map is centred on it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let marker: maplibregl.Marker | null = null;
    const frame = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      const ring = survey.geom?.coordinates[0];
      const point: [number, number] | null =
        survey.application?.pin?.coordinates ??
        (ring ? [(Math.min(...ring.map((c) => c[0]!)) + Math.max(...ring.map((c) => c[0]!))) / 2, (Math.min(...ring.map((c) => c[1]!)) + Math.max(...ring.map((c) => c[1]!))) / 2] : null);
      if (map && point) marker = new maplibregl.Marker({ element: pinElement("partial"), anchor: "bottom" }).setLngLat(point).addTo(map);
      if (outline) mapRef.current?.setHighlight(outline.geometry);
      if (survey.geom) {
        const ring = survey.geom.coordinates[0]!;
        const xs = ring.map((c) => c[0]!);
        const ys = ring.map((c) => c[1]!);
        mapRef.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 20);
        // The drawn land fills the view with the pin in the middle.
        if (point && map) map.once("moveend", () => !cancelled && map.easeTo({ center: point, duration: 300 }));
      } else if (point) mapRef.current?.flyTo(point, 18);
      else if (outline) mapRef.current?.fitBounds(outline.bbox, 18);
    };
    const wait = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map) {
        timer = setTimeout(wait, 100);
        return;
      }
      if (map.isStyleLoaded() && map.getSource("highlight")) frame();
      else map.once("load", frame);
    };
    wait();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      marker?.remove();
    };
  }, [outline, survey.geom, survey.application?.pin]);

  function startDrawing() {
    draw.current?.setMode("polygon");
    setMode("polygon");
    setMethod("drawn");
  }
  function selectMode() {
    draw.current?.setMode("select");
    setMode("select");
  }
  /** The 4 corners are in: the shape replaces any drawn before and its corners can be fixed by dragging. */
  function cornersDone(p: Polygon, reordered: boolean) {
    setCornering(false);
    putPolygon(p);
    setPolygon(p);
    setMethod("drawn");
    setGeomDirty(true);
    setDirty(true);
    const id = draw.current?.getSnapshot().at(-1)?.id;
    if (id !== undefined) draw.current?.selectFeature(id);
    if (reordered) toast.warning(tm("crossed"));
    else toast.success(tm("done"));
  }
  function clearShape() {
    putPolygon(null);
    setPolygon(null);
    setWalk(null);
  }

  // ---- GPS walk: stand at each corner and record it ------------------------
  function addWalkPoint() {
    if (!navigator.geolocation) return toast.error(t("gpsUnavailable"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const pt: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setWalk((w) => {
          const next = { points: [...(w?.points ?? []), pt], worst: Math.max(w?.worst ?? 0, Math.round(pos.coords.accuracy)) };
          if (next.points.length >= 3) {
            const p: Polygon = { type: "Polygon", coordinates: [[...next.points, next.points[0]!]] };
            putPolygon(p);
            setPolygon(p);
          }
          return next;
        });
        setMethod("gps_walk");
        mapRef.current?.flyTo(pt, 19);
      },
      () => {
        setLocating(false);
        toast.error(t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }
  function finishWalk() {
    if (walk) setAccuracy(walk.worst);
    setWalk(null);
    const id = draw.current?.getSnapshot().at(-1)?.id;
    if (id !== undefined) draw.current?.selectFeature(id);
  }

  // ---- Save / autosave ---------------------------------------------------------
  const save = useCallback(
    async (quiet: boolean) => {
      if (!canEdit) return true;
      setSaving(true);
      setError(null);
      const sendGeom = geomDirty && polygon && !measure(polygon).selfIntersects;
      const res = await saveSurveyAction({
        surveyId: survey.id,
        ...(sendGeom ? { geojson: toWire(polygon), method, accuracyM: accuracy } : {}),
        neighbours,
        building: { ...building, floors: building.floors ?? null },
        notes,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        if (!quiet) toast.error(t("saveFailed"));
        return false;
      }
      if (sendGeom) setGeomDirty(false);
      setDirty(false);
      setSavedAt(new Date());
      return true;
    },
    [canEdit, geomDirty, polygon, method, accuracy, neighbours, building, notes, survey.id, t],
  );

  useEffect(() => {
    if (!dirty || !canEdit || m.selfIntersects) return;
    const h = setTimeout(() => void save(true), 3000);
    return () => clearTimeout(h);
  }, [dirty, canEdit, m.selfIntersects, save]);

  const touch = () => setDirty(true);

  async function submit() {
    setBusy(true);
    const ok = await save(false);
    if (!ok) {
      setBusy(false);
      setConfirmSubmit(false);
      return;
    }
    const res = await submitSurveyAction({ surveyId: survey.id });
    setBusy(false);
    setConfirmSubmit(false);
    if (!res.ok) return setError(res.error);
    if (res.data.status === "overlap_review") {
      setOverlaps(res.data.overlaps.map((o) => ({ ...o, parcel_id: "", status: "" })));
      toast.warning(t("submittedWithOverlaps"));
    } else toast.success(t("submittedOk"));
    router.refresh();
  }

  async function decide() {
    if (!review) return;
    setBusy(true);
    setError(null);
    const res = await gisReviewAction({ surveyId: survey.id, action: review, note: reviewNote, geojson: review === "accept" && geomDirty && polygon ? toWire(polygon) : null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setReview(null);
    toast.success(review === "accept" ? t("reviewAccepted") : t("reviewReturned"));
    router.refresh();
  }

  // ---- Photos ------------------------------------------------------------------
  async function uploadPhoto(file: File) {
    setUploading(true);
    const pos = await new Promise<GeolocationPosition | null>((resolve) =>
      navigator.geolocation ? navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }) : resolve(null),
    );
    const form = new FormData();
    form.set("surveyId", survey.id);
    form.set("file", file);
    if (pos) {
      form.set("lon", String(pos.coords.longitude));
      form.set("lat", String(pos.coords.latitude));
    }
    const res = await uploadSurveyPhotoAction(form);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(res.error);
    toast.success(t("photoAdded"));
    router.refresh();
  }
  async function openPhoto(id: string) {
    const res = await photoUrlAction({ photoId: id });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  const app = survey.application;

  const steps: { key: "boundary" | "neighbours" | "building" | "photos" | "submit"; done: boolean }[] = [
    { key: "boundary", done: !!polygon },
    { key: "neighbours", done: (["north", "east", "south", "west"] as const).every((k) => (neighbours[k] ?? "").trim() !== "") },
    { key: "building", done: !!survey.building?.type || building.type !== "none" },
    { key: "photos", done: survey.survey_photos.some((p) => !p.deleted_at) },
    { key: "submit", done: !canEdit },
  ];
  const nextStep = steps.find((s) => !s.done);
  const go = (key: string) => document.getElementById(`survey-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
    {canEdit && (
      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-center">
          <ol className="flex flex-1 flex-wrap gap-x-5 gap-y-2 text-sm">
            {steps.map((st, i) => (
              <li key={st.key}>
                <button type="button" onClick={() => go(st.key)} className={`flex items-center gap-2 ${st === nextStep ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs tabular-nums ${st.done ? "border-success text-success" : st === nextStep ? "border-primary text-primary" : ""}`}
                  >
                    {st.done ? <Check className="size-3.5" aria-label={t("flow.done")} /> : i + 1}
                  </span>
                  {t(`flow.${st.key}`)}
                </button>
              </li>
            ))}
          </ol>
          {nextStep && (
            <Button size="sm" className="self-start md:self-auto" onClick={() => go(nextStep.key)}>
              {t(`flow.go_${nextStep.key}`)}
              <ArrowRight aria-hidden />
            </Button>
          )}
        </CardContent>
      </Card>
    )}
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <div className="relative scroll-mt-20" id="survey-boundary">
          <DhulkaMap ref={mapRef} parcels base={base} visible={{ facilities: false, streets: true }} className="h-[60vh] min-h-[420px] overflow-hidden rounded-lg border lg:h-[calc(100vh-14rem)]" />
          <div className="absolute start-3 top-3 flex flex-wrap gap-1.5">
            {editable && (
              <>
                <Button size="sm" variant={mode === "polygon" ? "default" : "outline"} className="bg-card" onClick={startDrawing} disabled={!!walk || cornering}>
                  <PenLine aria-hidden />
                  {polygon ? t("redraw") : t("draw")}
                </Button>
                <Button size="sm" variant={mode === "select" ? "default" : "outline"} className="bg-card" onClick={selectMode} disabled={!polygon}>
                  <MousePointer2 aria-hidden />
                  {t("editCorners")}
                </Button>
                {canCorners && (
                  <Button
                    size="sm"
                    variant={cornering ? "default" : "outline"}
                    className="bg-card"
                    disabled={!!walk}
                    aria-pressed={cornering}
                    onClick={() => {
                      if (!cornering) selectMode();
                      setCornering(!cornering);
                    }}
                  >
                    <Scan aria-hidden />
                    {tm("button")}
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="outline" className="bg-card" disabled={cornering} onClick={() => (walk ? finishWalk() : setWalk({ points: [], worst: 0 }))}>
                    <Footprints aria-hidden />
                    {walk ? t("finishWalk") : t("gpsWalk")}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="bg-card" onClick={clearShape} disabled={!polygon}>
                  <Trash2 aria-hidden />
                  {t("clear")}
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" className="bg-card" onClick={() => setBase((b) => (b === "satellite" ? "streets" : "satellite"))}>
              <Layers aria-hidden />
              {base === "satellite" ? t("streets") : t("satellite")}
            </Button>
          </div>
          {cornering && <CornerPointer getMap={() => mapRef.current?.getMap()} onDone={cornersDone} onCancel={() => setCornering(false)} />}
          {walk && (
            <div className="absolute inset-x-3 bottom-10 rounded-md border bg-card-solid p-3 text-sm shadow-sm sm:inset-x-auto sm:start-3 sm:w-80">
              <p className="font-medium">{t("walkTitle", { count: walk.points.length })}</p>
              <p className="text-muted-foreground">{t("walkHelp")}</p>
              {walk.points.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("walkAccuracy", { m: walk.worst })}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={addWalkPoint} loading={locating}>
                  {t("addCorner")}
                </Button>
                {walk.points.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const pts = walk.points.slice(0, -1);
                      setWalk({ ...walk, points: pts });
                      const p: Polygon | null = pts.length >= 3 ? { type: "Polygon", coordinates: [[...pts, pts[0]!]] } : null;
                      putPolygon(p);
                      setPolygon(p);
                    }}
                  >
                    <Undo2 aria-hidden />
                    {t("undoCorner")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{mode === "polygon" ? t("drawHelp") : editable ? t("editHelp") : t("viewHelp")}</p>
      </div>

      <div className="space-y-4">
        <Card id="survey-submit" className="scroll-mt-20">
          <CardContent className="space-y-3 pt-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="label-caps text-muted-foreground">{t("area")}</p>
                <p className="text-xl font-semibold tabular-nums">{m.area != null ? `${format.number(m.area, { maximumFractionDigits: 1 })} m²` : "—"}</p>
              </div>
              <div>
                <p className="label-caps text-muted-foreground">{t("perimeter")}</p>
                <p className="text-xl font-semibold tabular-nums">{m.perimeter != null ? `${format.number(m.perimeter, { maximumFractionDigits: 1 })} m` : "—"}</p>
              </div>
              {declared && (
                <p className={`col-span-2 text-xs ${areaGapPct != null && Math.abs(areaGapPct) > 20 ? "rounded-md border border-status-pending/40 bg-status-pending/10 px-2 py-1.5" : "text-muted-foreground"}`}>
                  {t("declaredArea", { area: format.number(declared, { maximumFractionDigits: 1 }) })}
                  {areaGapPct != null && Math.abs(areaGapPct) > 20 && ` ${t("areaGap", { pct: areaGapPct > 0 ? `+${areaGapPct}` : areaGapPct })}`}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`methods.${method}`)}
              {accuracy != null && ` · ${t("accuracy", { m: accuracy })}`}
              {app && ` · ${app.number}`}
            </p>
            {m.selfIntersects && (
              <Alert tone="danger" title={t("selfIntersects")}>
                {t("selfIntersectsBody")}
              </Alert>
            )}
            {fe("geometry") && <Alert tone="danger" title={fe("geometry")} />}
            <FormError error={error && !error.fieldErrors ? error : null} />
            {overlaps.length > 0 && (
              <Alert tone="warning" title={t("overlapsTitle")}>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {overlaps.map((o, i) => (
                    <li key={i}>
                      <Mono>{o.pun ?? t("unregisteredParcel")}</Mono> — {format.number(Number(o.overlap_m2), { maximumFractionDigits: 1 })} m²
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">{canReview ? t("overlapsReviewHelp") : t("overlapsHelp")}</p>
              </Alert>
            )}
            {survey.status === "returned" && survey.review_note && (
              <Alert tone="warning" title={t("returnedTitle")}>
                {survey.review_note}
              </Alert>
            )}
            {canEdit && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  {saving ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      {t("saving")}
                    </span>
                  ) : dirty ? (
                    t("unsaved")
                  ) : savedAt ? (
                    t("savedAt", { time: format.dateTime(savedAt, { timeStyle: "short" }) })
                  ) : null}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void save(false)} disabled={saving || m.selfIntersects}>
                    {tc("save")}
                  </Button>
                  <Button size="sm" onClick={() => setConfirmSubmit(true)} disabled={!polygon || m.selfIntersects || saving}>
                    <Check aria-hidden />
                    {t("submit")}
                  </Button>
                </div>
              </div>
            )}
            {canReview && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setReview("return")}>
                  {t("returnToSurveyor")}
                </Button>
                <Button size="sm" onClick={() => setReview("accept")} disabled={!polygon || m.selfIntersects}>
                  {geomDirty ? t("acceptEdited") : t("accept")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="survey-neighbours" className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">{t("neighbours")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {(["north", "east", "south", "west"] as const).map((k) => (
              <Field key={k} id={`n-${k}`} label={t(`sides.${k}`)}>
                <Input
                  value={neighbours[k] ?? ""}
                  disabled={!canEdit}
                  maxLength={120}
                  onChange={(e) => {
                    setNeighbours((n) => ({ ...n, [k]: e.target.value }));
                    touch();
                  }}
                />
              </Field>
            ))}
          </CardContent>
        </Card>

        <Card id="survey-building" className="scroll-mt-20">
          <CardHeader>
            <CardTitle className="text-base">{t("building")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field id="b-type" label={t("buildingType")}>
              <NativeSelect
                value={building.type ?? "none"}
                disabled={!canEdit}
                onChange={(e) => {
                  setBuilding((b) => ({ ...b, type: e.target.value }));
                  touch();
                }}
              >
                {BUILDING_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {t(`buildingTypes.${b}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="b-floors" label={t("floors")}>
              <Input
                type="number"
                min={0}
                max={60}
                value={building.floors ?? ""}
                disabled={!canEdit || building.type === "none"}
                onChange={(e) => {
                  setBuilding((b) => ({ ...b, floors: e.target.value === "" ? null : Math.max(0, Math.min(60, Math.trunc(Number(e.target.value)))) }));
                  touch();
                }}
              />
            </Field>
            <Field id="b-condition" label={t("condition")}>
              <NativeSelect
                value={building.condition ?? ""}
                disabled={!canEdit || building.type === "none"}
                onChange={(e) => {
                  setBuilding((b) => ({ ...b, condition: e.target.value }));
                  touch();
                }}
              >
                <option value="">—</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`conditions.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="b-use" label={t("buildingUse")}>
              <Input
                value={building.use ?? ""}
                maxLength={40}
                disabled={!canEdit || building.type === "none"}
                onChange={(e) => {
                  setBuilding((b) => ({ ...b, use: e.target.value }));
                  touch();
                }}
              />
            </Field>
            <div className="col-span-2">
              <Field id="notes" label={t("notes")}>
                <Textarea
                  rows={3}
                  value={notes}
                  maxLength={2000}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    touch();
                  }}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card id="survey-photos" className="scroll-mt-20">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              {t("photos")} ({survey.survey_photos.length})
            </CardTitle>
            {canEdit && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-label={t("addPhoto")}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPhoto(f);
                  }}
                />
                <Button size="sm" variant="outline" loading={uploading} onClick={() => fileRef.current?.click()}>
                  <Camera aria-hidden />
                  {t("addPhoto")}
                </Button>
              </>
            )}
          </CardHeader>
          <CardContent>
            {fe("file") && <p className="mb-2 text-sm text-status-rejected">{fe("file")}</p>}
            {survey.survey_photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPhotos")}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {survey.survey_photos.map((p, i) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>
                      {t("photoN", { n: i + 1 })}
                      <span className="ms-2 text-xs text-muted-foreground">
                        {p.lat != null && p.lon != null ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : t("noGps")}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => void openPhoto(p.id)}>
                      <Upload aria-hidden className="rotate-45" />
                      {t("view")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title={t("submitTitle")}
        description={t("submitBody", { area: format.number(m.area ?? 0, { maximumFractionDigits: 1 }) })}
        confirmLabel={t("submit")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() => void submit()}
      />
      <ConfirmDialog
        open={review !== null}
        onOpenChange={(o) => !o && setReview(null)}
        title={review === "accept" ? t("acceptTitle") : t("returnTitle")}
        description={review === "accept" ? t("acceptBody") : t("returnBody")}
        confirmLabel={review === "accept" ? t("accept") : t("returnToSurveyor")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() => void decide()}
      >
        <FormError error={error && !error.fieldErrors ? error : null} />
        <Field id="review-note" label={review === "return" ? t("reason") : t("noteOptional")} error={fe("note")} required={review === "return"}>
          <Textarea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
    </>
  );
}
