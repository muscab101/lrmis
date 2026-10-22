"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { UserCheck } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { assignZoneAction, districtSurveyorsAction } from "@/app/[locale]/(staff)/parcels/yet-to-register/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { ZonePlace } from "@/lib/server/zones";

type Named = { id: string; name_so: string; name_en: string };

interface Props {
  districts: Named[];
  sections: ZonePlace[];
  sectors: ZonePlace[];
  neighbourhoods: (ZonePlace & { capacity: number | null })[];
  /** Per neighbourhood: land waiting and registered, and whether a zone is already open there. */
  status: Record<string, { partial: number; registered: number; openZone: string | null }>;
}

/** District → section → sector → neighbourhood, then its capacity, then the surveyor who takes it. */
export function ZoneAssigner({ districts, sections, sectors, neighbourhoods, status }: Props) {
  const t = useTranslations("yetToRegister.assign");
  const locale = useLocale();
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  const [district, setDistrict] = useState(districts.length === 1 ? districts[0]!.id : "");
  const [section, setSection] = useState("");
  const [sector, setSector] = useState("");
  const [nbhd, setNbhd] = useState("");
  const [surveyor, setSurveyor] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [surveyors, setSurveyors] = useState<{ user_id: string; full_name: string; open_zones: number; open_tasks: number }[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);

  const sectionList = useMemo(() => sections.filter((s) => s.parent === district), [sections, district]);
  const sectorList = useMemo(() => sectors.filter((s) => s.parent === section), [sectors, section]);
  const nbhdList = useMemo(() => neighbourhoods.filter((n) => n.parent === sector), [neighbourhoods, sector]);
  const chosen = neighbourhoods.find((n) => n.id === nbhd) ?? null;
  const info = nbhd ? status[nbhd] : undefined;

  useEffect(() => {
    setSurveyors([]);
    setSurveyor("");
    if (!district) return;
    void districtSurveyorsAction({ districtId: district }).then((r) => r.ok && setSurveyors(r.data));
  }, [district]);

  // The target starts at the neighbourhood's capacity.
  useEffect(() => setTarget(chosen?.capacity ? String(chosen.capacity) : ""), [chosen]);

  const assign = async () => {
    setSaving(true);
    setError(null);
    const res = await assignZoneAction({ neighbourhoodId: nbhd, surveyorId: surveyor, target: target.trim() === "" ? Number.NaN : Number(target), note });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("assigned"));
    setNbhd("");
    setNote("");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="zoneDistrict" label={t("district")} required>
          <NativeSelect
            value={district}
            onChange={(e) => {
              setDistrict(e.target.value);
              setSection("");
              setSector("");
              setNbhd("");
            }}
          >
            <option value="">{t("choose")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="zoneSection" label={t("section")} required>
          <NativeSelect
            value={section}
            disabled={!district}
            onChange={(e) => {
              setSection(e.target.value);
              setSector("");
              setNbhd("");
            }}
          >
            <option value="">{sectionList.length ? t("choose") : t("none")}</option>
            {sectionList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {name(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="zoneSector" label={t("sector")} required>
          <NativeSelect
            value={sector}
            disabled={!section}
            onChange={(e) => {
              setSector(e.target.value);
              setNbhd("");
            }}
          >
            <option value="">{sectorList.length ? t("choose") : t("none")}</option>
            {sectorList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {name(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="neighbourhoodId" label={t("neighbourhood")} error={fe("neighbourhoodId")} required>
          <NativeSelect value={nbhd} disabled={!sector} onChange={(e) => setNbhd(e.target.value)}>
            <option value="">{nbhdList.length ? t("choose") : t("none")}</option>
            {nbhdList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.code} · {name(n)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {chosen && (
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-4">
          <div>
            <div className="label-caps text-muted-foreground">{t("capacity")}</div>
            <div className="text-lg font-semibold tabular-nums">{chosen.capacity != null ? format.number(chosen.capacity) : "—"}</div>
          </div>
          <div>
            <div className="label-caps text-muted-foreground">{t("registered")}</div>
            <div className="text-lg font-semibold tabular-nums">{format.number(info?.registered ?? 0)}</div>
          </div>
          <div>
            <div className="label-caps text-muted-foreground">{t("partial")}</div>
            <div className="text-lg font-semibold tabular-nums">{format.number(info?.partial ?? 0)}</div>
          </div>
          <div>
            <div className="label-caps text-muted-foreground">{t("zone")}</div>
            <div className={info?.openZone ? "text-status-pending" : "text-muted-foreground"}>{info?.openZone ? t("openZone", { name: info.openZone }) : t("noZone")}</div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_1fr]">
        <Field id="surveyorId" label={t("surveyor")} error={fe("surveyorId")} hint={district && surveyors.length === 0 ? t("noSurveyors") : undefined} required>
          <NativeSelect value={surveyor} disabled={!district || surveyors.length === 0} onChange={(e) => setSurveyor(e.target.value)}>
            <option value="">{t("choose")}</option>
            {surveyors.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name} — {t("load", { zones: s.open_zones, tasks: s.open_tasks })}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="target" label={t("target")} hint={t("targetHint")} error={fe("target")} required>
          <Input type="number" inputMode="numeric" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field id="note" label={t("note")} error={fe("note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <FormError error={error} />
      <div className="flex justify-end">
        <Button onClick={() => void assign()} loading={saving} disabled={!nbhd || !surveyor || Boolean(info?.openZone)}>
          <UserCheck aria-hidden />
          {t("submit")}
        </Button>
      </div>
    </div>
  );
}
