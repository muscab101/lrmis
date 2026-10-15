"use client";

import type { AppError } from "@dhulka/core/errors";
import { FACILITY_KINDS, type LocationInput, type LocationLevel } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { LocationRow } from "@/lib/server/locations";
import { listChildrenAction, saveLocationAction } from "./actions";

type Opt = { id: string; code: string; name_so: string; name_en: string };

interface Props {
  level: LocationLevel;
  row: LocationRow | null;
  districts: Opt[];
  defaultDistrictId: string | null;
  onClose: () => void;
}

/** Create / edit one location in a side sheet. Parent pickers cascade district → section → sector. */
export function LocationSheet({ level, row, districts, defaultDistrictId, onClose }: Props) {
  const t = useTranslations("locations");
  const tc = useTranslations("common");
  const tm = useTranslations("map");
  const locale = useLocale();
  const vm = useValidationMessage();
  const router = useRouter();
  const label = (o: Opt) => `${o.code} · ${locale === "so" ? o.name_so : o.name_en || o.name_so}`;

  const [code, setCode] = useState(row?.code ?? "");
  const [nameSo, setNameSo] = useState(row?.name_so ?? "");
  const [nameEn, setNameEn] = useState(row?.name_en ?? "");
  const [capacity, setCapacity] = useState(row?.capacity?.toString() ?? "");
  const [kind, setKind] = useState(row?.kind ?? "other");
  const [districtId, setDistrictId] = useState(row?.district?.id ?? defaultDistrictId ?? "");
  const [sectionId, setSectionId] = useState(row?.section?.id ?? row?.sector?.section_id ?? "");
  const [sectorId, setSectorId] = useState(row?.sector?.id ?? "");
  const [sections, setSections] = useState<Opt[]>([]);
  const [sectors, setSectors] = useState<Opt[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  const needsSection = level === "sectors" || level === "neighbourhoods";
  const needsSector = level === "neighbourhoods";
  const hasCode = level !== "streets" && level !== "facilities";

  useEffect(() => {
    if (!needsSection || !districtId) return setSections([]);
    void listChildrenAction({ level: "sections", parentId: districtId }).then((r) => r.ok && setSections(r.data));
  }, [districtId, needsSection]);

  useEffect(() => {
    if (!needsSector || !sectionId) return setSectors([]);
    void listChildrenAction({ level: "sectors", parentId: sectionId }).then((r) => r.ok && setSectors(r.data));
  }, [sectionId, needsSector]);

  const fieldError = (name: string) => vm(error?.fieldErrors?.[`input.${name}`]?.[0] ?? error?.fieldErrors?.[name]?.[0]);

  function buildInput(): LocationInput {
    const base = { code, nameSo, nameEn };
    switch (level) {
      case "districts":
        return { level, ...base };
      case "sections":
        return { level, parentId: districtId, ...base };
      case "sectors":
        return { level, parentId: sectionId, ...base };
      case "neighbourhoods":
        return { level, parentId: sectorId, ...base, capacity: capacity === "" ? null : Number(capacity) };
      case "streets":
        return { level, parentId: districtId, nameSo, nameEn };
      case "facilities":
        return { level, parentId: districtId, nameSo, nameEn, kind: kind as (typeof FACILITY_KINDS)[number] };
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await saveLocationAction({ id: row?.id ?? null, input: buildInput() });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(row ? tc("saved") : t("created"));
    router.refresh();
    onClose();
  }

  const parentError = fieldError("parentId");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={tc("close")}>
        <form onSubmit={submit} className="flex h-full flex-col" noValidate>
          <div className="border-b px-6 py-5">
            <DialogTitle className="text-lg font-semibold">{row ? t(`edit_${level}`) : t(`new_${level}`)}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{t(`help_${level}`)}</DialogDescription>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <FormError error={error && error.code !== "VALIDATION" ? error : null} />

            {level !== "districts" && (
              <Field id="districtId" label={t("district")} error={!needsSection ? parentError : undefined} required>
                <NativeSelect
                  value={districtId}
                  onChange={(e) => {
                    setDistrictId(e.target.value);
                    setSectionId("");
                    setSectorId("");
                  }}
                >
                  <option value="">{t("choose")}</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {label(d)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {needsSection && (
              <Field id="sectionId" label={t("section")} error={level === "sectors" ? parentError : undefined} required>
                <NativeSelect
                  value={sectionId}
                  disabled={!districtId}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setSectorId("");
                  }}
                >
                  <option value="">{districtId && sections.length === 0 ? t("noSections") : t("choose")}</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(s)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {needsSector && (
              <Field id="sectorId" label={t("sector")} error={parentError} required>
                <NativeSelect value={sectorId} disabled={!sectionId} onChange={(e) => setSectorId(e.target.value)}>
                  <option value="">{sectionId && sectors.length === 0 ? t("noSectors") : t("choose")}</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(s)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}

            {hasCode && (
              <Field id="code" label={t("code")} hint={level === "neighbourhoods" ? t("codeHintNeighbourhood") : t("codeHint")} error={fieldError("code")} required>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={level === "districts" ? 6 : 8} className="font-mono uppercase" />
              </Field>
            )}
            <Field id="nameSo" label={t("nameSo")} error={fieldError("nameSo")} required>
              <Input value={nameSo} onChange={(e) => setNameSo(e.target.value)} />
            </Field>
            <Field id="nameEn" label={t("nameEn")} error={fieldError("nameEn")} required={hasCode}>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            {level === "neighbourhoods" && (
              <Field id="capacity" label={t("capacity")} hint={t("capacityHint")} error={fieldError("capacity")}>
                <Input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </Field>
            )}
            {level === "facilities" && (
              <Field id="kind" label={t("kind")}>
                <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>
                  {FACILITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {tm(`facility_${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {row ? tc("saveChanges") : t("create")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Dialog>
  );
}
