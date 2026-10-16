"use client";

import type { AppError } from "@dhulka/core/errors";
import type { LocationLevel } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Upload } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DhulkaMap, type DhulkaMapHandle } from "@/components/map/dhulka-map";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { LocationRow } from "@/lib/server/locations";
import { getGeometryAction, setGeometryAction } from "./actions";

/** View a location's boundary and replace it from a GeoJSON file or pasted GeoJSON. */
export function BoundarySheet({ level, row, canEdit, onClose }: { level: LocationLevel; row: LocationRow; canEdit: boolean; onClose: () => void }) {
  const t = useTranslations("locations");
  const tc = useTranslations("common");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const mapRef = useRef<DhulkaMapHandle>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasGeom, setHasGeom] = useState(row.has_geom);

  async function loadPreview() {
    const res = await getGeometryAction({ level, id: row.id });
    if (res.ok && res.data) {
      mapRef.current?.setHighlight(res.data.geometry);
      mapRef.current?.fitBounds(res.data.bbox, 16);
    }
  }

  useEffect(() => {
    // Wait a tick so the map exists before drawing the highlight.
    const h = setTimeout(() => void loadPreview(), 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) return setError({ code: "VALIDATION", requestId: "—", fieldErrors: { geojson: ["validation.too_long"] } });
    setText(await file.text());
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await setGeometryAction({ level, id: row.id, geojson: text });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    const { area_m2, length_m } = res.data;
    toast.success(
      t("boundarySaved", {
        size: area_m2 ? `${format.number(area_m2 / 10_000, { maximumFractionDigits: 2 })} ha` : length_m ? `${format.number(length_m, { maximumFractionDigits: 0 })} m` : "",
      }),
    );
    setText("");
    setHasGeom(true);
    await loadPreview();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-2xl" closeLabel={tc("close")}>
        <div className="border-b px-6 py-5">
          <DialogTitle className="text-lg font-semibold">
            {t("boundaryOf", { name: row.name_so })}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t("boundaryHelp")}</DialogDescription>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="relative h-72 overflow-hidden rounded-md border">
            <DhulkaMap ref={mapRef} className="absolute inset-0" />
            {!hasGeom && (
              <div className="absolute inset-x-3 top-3 rounded-sm bg-card/95 px-3 py-2 text-xs shadow">{t("noBoundaryYet")}</div>
            )}
          </div>

          {canEdit && (
            <>
              <FormError error={error && !error.fieldErrors ? error : null} />
              {error?.code === "VALIDATION" && error.values?.detail && (
                <Alert tone="danger" title={t(`geomError_${String(error.values.detail).replace(/\s+/g, "_")}`)} />
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  <Upload className="size-4" aria-hidden />
                  {t("chooseFile")}
                  <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
                </label>
                <span className="text-xs text-muted-foreground">{t("fileHint")}</span>
              </div>
              <Field id="geojson" label={t("pasteGeojson")} error={vm(error?.fieldErrors?.geojson?.[0])}>
                <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder='{"type":"Polygon","coordinates":[[[45.3,2.03],…]]}' />
              </Field>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("close")}
          </Button>
          {canEdit && (
            <Button type="button" loading={saving} disabled={text.trim().length < 10} onClick={() => void save()}>
              {t("saveBoundary")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
