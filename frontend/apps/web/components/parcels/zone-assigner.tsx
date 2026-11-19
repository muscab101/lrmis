"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { MapPinned, UserCheck } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { assignNeighbourhoodRemapAction, assignZoneAction, districtSurveyorsAction, neighbourhoodRemapSummaryAction } from "@/app/[locale]/(staff)/parcels/yet-to-register/actions";
import { FormError } from "@/components/forms/form-error";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
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
  /** Start with this neighbourhood chosen (Assign zone on a row below). */
  initialNeighbourhood?: string | null;
  /** Start on this job: a survey zone (register new land) or remapping the land already in the system. */
  initialJob?: "zone" | "remap";
}

/**
 * District → section → sector → neighbourhood, then its capacity, then the surveyor who takes it. Or, for Remapping,
 * the neighbourhood's land already in the system goes to one surveyor to put where it really is on the map.
 */
export function ZoneAssigner({ districts, sections, sectors, neighbourhoods, status, initialNeighbourhood = null, initialJob = "zone" }: Props) {
  const t = useTranslations("yetToRegister.assign");
  const [job, setJob] = useState<"zone" | "remap">(initialJob);
  const [remap, setRemap] = useState<{ total: number; guessed: number; assigned: number } | null>(null);
  const [onlyGuessed, setOnlyGuessed] = useState(false);
  // Follow the page's address (a link back to the zones, the browser's back button).
  useEffect(() => setJob(initialJob), [initialJob]);
  const locale = useLocale();
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const name = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  // A neighbourhood picked from a row fills in its sector, section and district.
  const start = neighbourhoods.find((n) => n.id === initialNeighbourhood);
  const startSector = start ? sectors.find((k) => k.id === start.parent) : undefined;
  const startSection = startSector ? sections.find((s) => s.id === startSector.parent) : undefined;
  const [district, setDistrict] = useState(startSection?.parent ?? (districts.length === 1 ? districts[0]!.id : ""));
  const [section, setSection] = useState(startSection?.id ?? "");
  const [sector, setSector] = useState(startSector?.id ?? "");
  const [nbhd, setNbhd] = useState(start?.id ?? "");
  const [surveyor, setSurveyor] = useState("");
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

  // Remapping: what the chosen neighbourhood has to remap.
  useEffect(() => {
    setRemap(null);
    if (job !== "remap" || !nbhd) return;
    void neighbourhoodRemapSummaryAction({ neighbourhoodId: nbhd }).then((r) => {
      if (!r.ok) return;
      setRemap(r.data);
      setOnlyGuessed(r.data.guessed > 0 && r.data.guessed < r.data.total);
    });
  }, [job, nbhd]);
  const remapCount = remap ? (onlyGuessed ? remap.guessed : remap.total) : 0;

  const assignRemap = async () => {
    setSaving(true);
    setError(null);
    const res = await assignNeighbourhoodRemapAction({ neighbourhoodId: nbhd, surveyorId: surveyor, note, onlyGuessed });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("remapAssigned", { count: res.data.count }));
    setNbhd("");
    setNote("");
    router.refresh();
  };

  const assign = async () => {
    setSaving(true);
    setError(null);
    // The zone's size is the neighbourhood's capacity.
    const res = await assignZoneAction({ neighbourhoodId: nbhd, surveyorId: surveyor, note });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("assigned"));
    setNbhd("");
    setNote("");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={t("job")} className="bg-muted inline-flex rounded-md p-0.5 text-sm">
        {(["zone", "remap"] as const).map((j) => (
          <button
            key={j}
            type="button"
            role="radio"
            aria-checked={job === j}
            onClick={() => {
              setJob(j);
              setError(null);
              // The table below follows the choice: survey zones (new land), or the remapping given out and how it goes.
              const q = new URLSearchParams(searchParams.toString());
              q.set("tab", "zones");
              q.delete("page");
              if (j === "remap") q.set("job", "remap");
              else q.delete("job");
              router.replace(`${pathname}?${q}`, { scroll: false });
            }}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${job === j ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t(j === "zone" ? "jobZone" : "jobRemap")}
          </button>
        ))}
      </div>
      {job === "remap" && <p className="text-muted-foreground text-sm">{t("remapHelp")}</p>}
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
                {name(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="neighbourhoodId" label={t("neighbourhood")} error={fe("neighbourhoodId")} required>
          <NativeSelect value={nbhd} disabled={!sector} onChange={(e) => setNbhd(e.target.value)}>
            <option value="">{nbhdList.length ? t("choose") : t("none")}</option>
            {nbhdList.map((n) => (
              <option key={n.id} value={n.id}>
                {/* Banaadir blocks are named by their code (BDSYKW01): say it once. */}
                {n.code === name(n) ? n.code : `${n.code} · ${name(n)}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {chosen && job === "remap" && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="label-caps text-muted-foreground">{t("remapTotal")}</div>
              <div className="text-lg font-semibold tabular-nums">{remap ? format.number(remap.total) : "…"}</div>
            </div>
            <div>
              <div className="label-caps text-muted-foreground">{t("remapGuessed")}</div>
              <div className="text-lg font-semibold tabular-nums">{remap ? format.number(remap.guessed) : "…"}</div>
            </div>
            <div>
              <div className="label-caps text-muted-foreground">{t("remapAlready")}</div>
              <div className="text-muted-foreground text-lg font-semibold tabular-nums">{remap ? format.number(remap.assigned) : "…"}</div>
            </div>
          </div>
          {remap && remap.guessed > 0 && (
            <label className="flex items-center gap-2">
              <Checkbox checked={onlyGuessed} onCheckedChange={(on) => setOnlyGuessed(on === true)} />
              {t("remapOnlyGuessed")}
            </label>
          )}
          {remap && remap.total === 0 && <p className="text-muted-foreground">{t("remapNothing")}</p>}
        </div>
      )}

      {chosen && job === "zone" && (
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-4">
          <div>
            <div className="label-caps text-muted-foreground">{t("capacity")}</div>
            <div className="text-lg font-semibold tabular-nums">{chosen.capacity ? format.number(chosen.capacity) : "—"}</div>
            {!chosen.capacity && <div className="text-status-rejected text-xs">{t("noCapacity")}</div>}
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

      <div className="grid gap-3 sm:grid-cols-2">
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
        <Field id="note" label={t("note")} error={fe("note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      {fe("target") && <p className="text-status-rejected text-sm">{fe("target")}</p>}
      <FormError error={error} />
      <div className="flex justify-end">
        {job === "remap" ? (
          <Button onClick={() => void assignRemap()} loading={saving} disabled={!nbhd || !surveyor || remapCount === 0}>
            <MapPinned aria-hidden />
            {t("remapSubmit", { count: remapCount })}
          </Button>
        ) : (
          <Button onClick={() => void assign()} loading={saving} disabled={!nbhd || !surveyor || !chosen?.capacity || Boolean(info?.openZone)}>
            <UserCheck aria-hidden />
            {t("submit")}
          </Button>
        )}
      </div>
    </div>
  );
}
