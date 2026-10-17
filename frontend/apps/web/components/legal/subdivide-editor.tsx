"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { area as turfArea } from "@turf/area";
import { Loader2, MousePointer2, PenLine, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { requestChangeAction } from "@/app/[locale]/(staff)/transfers/actions";
import { FormError } from "@/components/forms/form-error";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

type Polygon = GeoJSON.Polygon;

/** Draw two or more child polygons inside the parent; the server checks fit, overlap and area. */
export function SubdivideEditor({
  parcelId,
  parent,
  blockers,
  variant = "subdivide",
}: {
  parcelId: string;
  parent: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  blockers: string[];
  /** "correct": draw the one corrected boundary (Data Correction) instead of several new plots. */
  variant?: "subdivide" | "correct";
}) {
  const correct = variant === "correct";
  const t = useTranslations("legal");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [children, setChildren] = useState<{ id: string | number; geom: Polygon }[]>([]);
  const [mode, setMode] = useState<"select" | "polygon">("select");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const parentArea = turfArea({ type: "Feature", geometry: parent, properties: {} });
  const sum = children.reduce((s, c) => s + turfArea({ type: "Feature", geometry: c.geom, properties: {} }), 0);
  const diffPct = parentArea ? ((sum - parentArea) / parentArea) * 100 : 0;
  const m2 = (n: number) => `${format.number(n, { maximumFractionDigits: 1 })} m²`;

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
        mapRef.current?.setHighlight(parent);
        const ring = (parent.type === "Polygon" ? parent.coordinates[0] : parent.coordinates[0]![0])!;
        const xs = ring.map((c) => c[0]!);
        const ys = ring.map((c) => c[1]!);
        mapRef.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 21);
        // Snap to the parent's corners so shared edges line up.
        const corners = ring.map((c) => [c[0]!, c[1]!] as [number, number]);
        const snapping = {
          toCoordinate: true,
          toCustom: (e: { lng: number; lat: number }) => {
            const px = map.project([e.lng, e.lat]);
            let best: [number, number] | undefined;
            let bestD = 14;
            for (const c of corners) {
              const q = map.project(c);
              const d = Math.hypot(q.x - px.x, q.y - px.y);
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
            return best;
          },
        };
        const d = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map }),
          modes: [
            new TerraDrawPolygonMode({ snapping, editable: true, styles: { fillColor: "#c2410c", fillOpacity: 0.2, outlineColor: "#c2410c", outlineWidth: 2 } }),
            new TerraDrawSelectMode({
              flags: { polygon: { feature: { draggable: false, coordinates: { draggable: true, midpoints: true, deletable: true, snappable: snapping } } } },
              styles: { selectedPolygonColor: "#c2410c", selectedPolygonFillOpacity: 0.25, selectedPolygonOutlineColor: "#c2410c", selectedPolygonOutlineWidth: 2.5 },
            }),
          ],
        });
        d.start();
        d.setMode("select");
        draw.current = d;
        d.on("change", () => {
          setChildren(
            d
              .getSnapshot()
              .filter((f) => f.geometry.type === "Polygon" && !f.properties?.currentlyDrawing)
              .map((f) => ({ id: f.id!, geom: f.geometry as Polygon })),
          );
        });
        d.on("finish", () => {
          // A correction has one boundary: a new drawing replaces the previous one.
          if (correct) {
            const feats = d.getSnapshot().filter((f) => f.geometry.type === "Polygon");
            if (feats.length > 1) d.removeFeatures(feats.slice(0, -1).map((f) => f.id!));
          }
          setMode("select");
          d.setMode("select");
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
        /* map gone */
      }
      draw.current = null;
    };
    // Mounts once per parcel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDrawMode = (m: "select" | "polygon") => {
    setMode(m);
    draw.current?.setMode(m);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    const r = correct
      ? await requestChangeAction({ kind: "correction", parcelIds: [parcelId], correction: { geom: children[0]!.geom as { type: "Polygon"; coordinates: [number, number][][] } }, reason })
      : await requestChangeAction({ kind: "subdivide", parcelIds: [parcelId], children: children.map((c) => c.geom as { type: "Polygon"; coordinates: [number, number][][] }), reason });
    setBusy(false);
    if (r.ok) {
      toast.success(t("requested"));
      router.push(`/parcels/${parcelId}`);
    } else setError(r.error);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="relative">
        <DhulkaMap ref={mapRef} parcels base="satellite" visible={{ facilities: false, streets: true }} className="h-[60vh] min-h-[420px] overflow-hidden rounded-lg border" />
        <div className="absolute start-3 top-3 flex gap-1.5">
          <Button size="sm" variant={mode === "polygon" ? "default" : "outline"} className="bg-card" onClick={() => setDrawMode("polygon")}>
            <PenLine aria-hidden />
            {correct ? t("drawBoundary") : t("drawChild")}
          </Button>
          <Button size="sm" variant={mode === "select" ? "default" : "outline"} className="bg-card" onClick={() => setDrawMode("select")}>
            <MousePointer2 aria-hidden />
            {t("editShapes")}
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{correct ? t("correctBoundary") : t("subdivideTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{correct ? t("correctBoundaryHelp") : t("subdivideHelp")}</p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {blockers.length > 0 && <Alert tone="danger" title={correct ? t("blockedCorrectTitle") : t("blockedTitle")}>{blockers.map((b) => t(`blockers.${b}`)).join(" · ")}</Alert>}
          <dl className="grid grid-cols-[1fr_auto] gap-y-1">
            <dt className="text-muted-foreground">{t("parentArea")}</dt>
            <dd className="tabular-nums">{m2(parentArea)}</dd>
            <dt className="text-muted-foreground">{correct ? t("newArea") : t("childrenArea")}</dt>
            <dd className={`tabular-nums ${!correct && children.length >= 2 && Math.abs(diffPct) > 1 ? "text-status-rejected" : ""}`}>
              {m2(sum)} {children.length > 0 && <span className="text-xs">({diffPct >= 0 ? "+" : ""}{format.number(diffPct, { maximumFractionDigits: 1 })}%)</span>}
            </dd>
          </dl>
          {children.length === 0 ? (
            <p className="text-muted-foreground">{correct ? t("noBoundary") : t("noChildren")}</p>
          ) : (
            <ol className="divide-y">
              {children.map((c, i) => (
                <li key={String(c.id)} className="flex items-center justify-between py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-sm border border-[#c2410c] bg-[#c2410c]/25" />
                    {correct ? t("newBoundary") : t("childN", { n: i + 1 })}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {m2(turfArea({ type: "Feature", geometry: c.geom, properties: {} }))}
                    <Button size="icon-sm" variant="ghost" aria-label={t("remove")} onClick={() => draw.current?.removeFeatures([c.id])}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Field id="reason" label={t("reason")} error={error?.fieldErrors?.reason?.[0] ? vm(error.fieldErrors.reason[0]) : undefined} required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <FormError error={error} />}
          <Button className="w-full" disabled={busy || children.length < (correct ? 1 : 2) || blockers.length > 0} onClick={submit}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("submitRequest")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
