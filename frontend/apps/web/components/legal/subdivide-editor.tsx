"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { area as turfArea } from "@turf/area";
import { Loader2, MousePointer2, PenLine, Scissors, Trash2, UserPlus, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { searchPartiesAction } from "@/app/[locale]/(staff)/applications/actions";
import { requestChangeAction } from "@/app/[locale]/(staff)/transfers/actions";
import { FormError } from "@/components/forms/form-error";
import { PartyForm } from "@/components/owners/party-form";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import { splitPolygon } from "@/lib/split-polygon";

type Polygon = GeoJSON.Polygon;

/** 1 -> A, 2 -> B … (the same letters the database gives the new PUNs). */
const letter = (n: number) =>
  n <= 26
    ? String.fromCharCode(64 + n)
    : String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));

/** Draw two or more child polygons inside the parent; the server checks fit, overlap and area. */
export function SubdivideEditor({
  parcelId,
  parent,
  blockers,
  variant = "subdivide",
  pun = null,
  currentOwners = [],
  newOwner = null,
}: {
  parcelId: string;
  parent: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  blockers: string[];
  /** "correct": draw the one corrected boundary (Data Correction) instead of several new plots. */
  variant?: "subdivide" | "correct";
  /** The parent's PUN: the new parcels get it with A, B, C … on the end. */
  pun?: string | null;
  /** Who owns the parent now: a new parcel with no owners chosen keeps them. */
  currentOwners?: string[];
  /** Staff who may create owners can register a new one here. */
  newOwner?: {
    districts: { id: string; name_so: string; name_en: string }[];
    districtId: string | null;
  } | null;
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
  // The owners chosen for each new parcel (by drawing id), and which parcel a new owner is being registered for.
  const [ownersBy, setOwnersBy] = useState<Record<string, ComboOption[]>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const tc = useTranslations("common");
  const addOwner = (child: string, o: ComboOption) =>
    setOwnersBy((cur) => ({
      ...cur,
      [child]: (cur[child] ?? []).some((x) => x.value === o.value)
        ? (cur[child] ?? [])
        : [...(cur[child] ?? []), o],
    }));
  const searchOwners = useCallback(async (q: string): Promise<ComboOption[]> => {
    const res = await searchPartiesAction({ q });
    if (!res.ok) return [];
    return res.data.map((p) => ({
      value: p.id,
      label: p.full_name,
      hint: p.id_number ?? p.phone ?? "",
    }));
  }, []);
  const parentArea = turfArea({ type: "Feature", geometry: parent, properties: {} });
  const sum = children.reduce(
    (s, c) => s + turfArea({ type: "Feature", geometry: c.geom, properties: {} }),
    0,
  );
  const diffPct = parentArea ? ((sum - parentArea) / parentArea) * 100 : 0;
  const m2 = (n: number) => `${format.number(n, { maximumFractionDigits: 1 })} m²`;

  // Split by numbers: how many parcels, which way the cuts run, and each one's size (the last takes what is left).
  const single: Polygon | null =
    parent.type === "Polygon"
      ? parent
      : parent.coordinates.length === 1
        ? { type: "Polygon", coordinates: parent.coordinates[0]! }
        : null;
  const [direction, setDirection] = useState<"across" | "along">("across");
  const equal = (n: number) =>
    Array.from({ length: n - 1 }, () => (Math.floor((parentArea / n) * 10) / 10).toString());
  const [sizes, setSizes] = useState<string[]>(() => equal(2));
  const given = sizes.map((x) => Number(x));
  const rest = parentArea - given.reduce((s, a) => s + (a || 0), 0);
  const sizesOk = given.every((a) => a > 0) && rest > 0.5;
  const splitByNumbers = () => {
    const d = draw.current;
    if (!d || !single || !sizesOk) return;
    d.clear();
    d.addFeatures(
      splitPolygon(single, [...given, rest], direction).map((geometry) => ({
        type: "Feature",
        id: crypto.randomUUID(),
        geometry,
        properties: { mode: "polygon" },
      })),
    );
    setDrawMode("select");
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
        mapRef.current?.setHighlight(parent);
        const ring = (
          parent.type === "Polygon" ? parent.coordinates[0] : parent.coordinates[0]![0]
        )!;
        const xs = ring.map((c) => c[0]!);
        const ys = ring.map((c) => c[1]!);
        mapRef.current?.fitBounds(
          [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          21,
        );
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
            new TerraDrawPolygonMode({
              snapping,
              editable: true,
              styles: {
                fillColor: "#c2410c",
                fillOpacity: 0.2,
                outlineColor: "#c2410c",
                outlineWidth: 2,
              },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: {
                  feature: {
                    draggable: false,
                    coordinates: {
                      draggable: true,
                      midpoints: true,
                      deletable: true,
                      snappable: snapping,
                    },
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
      ? await requestChangeAction({
          kind: "correction",
          parcelIds: [parcelId],
          correction: {
            geom: children[0]!.geom as { type: "Polygon"; coordinates: [number, number][][] },
          },
          reason,
        })
      : await requestChangeAction({
          kind: "subdivide",
          parcelIds: [parcelId],
          children: children.map(
            (c) => c.geom as { type: "Polygon"; coordinates: [number, number][][] },
          ),
          childOwners: children.some((c) => ownersBy[String(c.id)]?.length)
            ? children.map((c) => (ownersBy[String(c.id)] ?? []).map((o) => o.value))
            : [],
          reason,
        });
    setBusy(false);
    if (r.ok) {
      toast.success(t("requested"));
      router.push(`/parcels/${parcelId}`);
    } else setError(r.error);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="relative">
        <DhulkaMap
          ref={mapRef}
          parcels
          base="satellite"
          visible={{ facilities: false, streets: true }}
          className="h-[60vh] min-h-[420px] overflow-hidden rounded-lg border"
        />
        <div className="absolute start-3 top-3 flex gap-1.5">
          <Button
            size="sm"
            variant={mode === "polygon" ? "default" : "outline"}
            className="bg-card"
            onClick={() => setDrawMode("polygon")}
          >
            <PenLine aria-hidden />
            {correct ? t("drawBoundary") : t("drawChild")}
          </Button>
          <Button
            size="sm"
            variant={mode === "select" ? "default" : "outline"}
            className="bg-card"
            onClick={() => setDrawMode("select")}
          >
            <MousePointer2 aria-hidden />
            {t("editShapes")}
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {correct ? t("correctBoundary") : t("subdivideTitle")}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {correct ? t("correctBoundaryHelp") : t("subdivideHelp")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {blockers.length > 0 && (
            <Alert tone="danger" title={correct ? t("blockedCorrectTitle") : t("blockedTitle")}>
              {blockers.map((b) => t(`blockers.${b}`)).join(" · ")}
            </Alert>
          )}
          <dl className="grid grid-cols-[1fr_auto] gap-y-1">
            <dt className="text-muted-foreground">{t("parentArea")}</dt>
            <dd className="tabular-nums">{m2(parentArea)}</dd>
            <dt className="text-muted-foreground">{correct ? t("newArea") : t("childrenArea")}</dt>
            <dd
              className={`tabular-nums ${!correct && children.length >= 2 && Math.abs(diffPct) > 1 ? "text-status-rejected" : ""}`}
            >
              {m2(sum)}{" "}
              {children.length > 0 && (
                <span className="text-xs">
                  ({diffPct >= 0 ? "+" : ""}
                  {format.number(diffPct, { maximumFractionDigits: 1 })}%)
                </span>
              )}
            </dd>
          </dl>
          {!correct && single && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium">{t("splitByNumbers")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field id="split-parts" label={t("splitParts")}>
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={sizes.length + 1}
                    onChange={(e) =>
                      setSizes(equal(Math.min(10, Math.max(2, Number(e.target.value) || 2))))
                    }
                  />
                </Field>
                <Field id="split-direction" label={t("splitDirection")}>
                  <NativeSelect
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as "across" | "along")}
                  >
                    <option value="across">{t("splitAcross")}</option>
                    <option value="along">{t("splitAlong")}</option>
                  </NativeSelect>
                </Field>
              </div>
              {sizes.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 shrink-0">{t("childN", { n: i + 1 })}</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    inputMode="decimal"
                    value={v}
                    aria-label={t("childN", { n: i + 1 })}
                    onChange={(e) => setSizes(sizes.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <span className="text-muted-foreground">m²</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0">{t("childN", { n: sizes.length + 1 })}</span>
                <span className={`tabular-nums ${rest > 0.5 ? "" : "text-status-rejected"}`}>
                  {m2(Math.max(0, rest))}
                </span>
                <span className="text-muted-foreground text-xs">{t("splitRest")}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!sizesOk}
                onClick={splitByNumbers}
              >
                <Scissors aria-hidden />
                {t("splitButton")}
              </Button>
            </div>
          )}
          {children.length === 0 ? (
            <p className="text-muted-foreground">{correct ? t("noBoundary") : t("noChildren")}</p>
          ) : (
            <ol className="divide-y">
              {children.map((c, i) => (
                <li key={String(c.id)} className="space-y-2 py-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="size-3 rounded-sm border border-[#c2410c] bg-[#c2410c]/25" />
                      {correct ? t("newBoundary") : t("childN", { n: i + 1 })}
                      {!correct && pun && (
                        <span className="font-mono text-xs">{pun + letter(i + 1)}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {m2(turfArea({ type: "Feature", geometry: c.geom, properties: {} }))}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("remove")}
                        onClick={() => draw.current?.removeFeatures([c.id])}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  </div>
                  {!correct && (
                    <ChildOwners
                      chosen={ownersBy[String(c.id)] ?? []}
                      currentOwners={currentOwners}
                      search={searchOwners}
                      onAdd={(o) => addOwner(String(c.id), o)}
                      onRemove={(v) =>
                        setOwnersBy((cur) => ({
                          ...cur,
                          [String(c.id)]: (cur[String(c.id)] ?? []).filter((x) => x.value !== v),
                        }))
                      }
                      newOwner={newOwner}
                      creating={creatingFor === String(c.id)}
                      onCreating={(on) => setCreatingFor(on ? String(c.id) : null)}
                      labels={{
                        add: t("addPerson"),
                        search: tc("search"),
                        none: tc("noResults"),
                        newButton: t("newOwnerButton"),
                        newTitle: t("newOwnerTitle"),
                        newSave: t("newOwnerSaveChild"),
                        keep: t("childKeepsOwners", { names: currentOwners.join(", ") || "—" }),
                        remove: t("remove"),
                      }}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          <Field
            id="reason"
            label={t("reason")}
            hint={reason.trim().length < 5 ? t("reasonMin") : undefined}
            error={error?.fieldErrors?.reason?.[0] ? vm(error.fieldErrors.reason[0]) : undefined}
            required
          >
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <FormError error={error} />}
          <Button
            className="w-full"
            disabled={
              busy ||
              children.length < (correct ? 1 : 2) ||
              blockers.length > 0 ||
              reason.trim().length < 5
            }
            onClick={submit}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("submitRequest")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** The owners of one new parcel: search for people, or register a new owner; none chosen keeps the current owners. */
function ChildOwners({
  chosen,
  currentOwners,
  search,
  onAdd,
  onRemove,
  newOwner,
  creating,
  onCreating,
  labels,
}: {
  chosen: ComboOption[];
  currentOwners: string[];
  search: (q: string) => Promise<ComboOption[]>;
  onAdd: (o: ComboOption) => void;
  onRemove: (value: string) => void;
  newOwner: {
    districts: { id: string; name_so: string; name_en: string }[];
    districtId: string | null;
  } | null;
  creating: boolean;
  onCreating: (on: boolean) => void;
  labels: {
    add: string;
    search: string;
    none: string;
    newButton: string;
    newTitle: string;
    newSave: string;
    keep: string;
    remove: string;
  };
}) {
  return (
    <div className="space-y-2 ps-5">
      {chosen.length === 0 ? (
        currentOwners.length > 0 && <p className="text-muted-foreground text-xs">{labels.keep}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((o, i) => (
            <li
              key={o.value}
              className="bg-muted flex items-center gap-1 rounded-md py-0.5 pe-0.5 ps-2 text-xs"
            >
              {o.label}
              {i === 0 && chosen.length > 1 && <span className="text-muted-foreground">★</span>}
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5"
                aria-label={labels.remove}
                onClick={() => onRemove(o.value)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <AsyncCombobox
            search={search}
            value={[]}
            onChange={(o) => o[0] && onAdd(o[0])}
            placeholder={labels.add}
            searchPlaceholder={labels.search}
            emptyText={labels.none}
          />
        </div>
        {newOwner && !creating && (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={labels.newButton}
            onClick={() => onCreating(true)}
          >
            <UserPlus aria-hidden />
          </Button>
        )}
      </div>
      {newOwner && creating && (
        <div className="bg-muted/40 space-y-3 rounded-md border p-3">
          <p className="text-sm font-semibold">{labels.newTitle}</p>
          <PartyForm
            party={null}
            districts={newOwner.districts}
            districtId={newOwner.districtId}
            onCancel={() => onCreating(false)}
            submitLabel={labels.newSave}
            onSaved={(id, values) => {
              onAdd({
                value: id,
                label: values.fullName,
                hint: values.idNumber || values.phone || "",
              });
              onCreating(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
