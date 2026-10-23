"use client";

import { NativeSelect } from "@dhulka/ui/form-controls";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

type Named = { id: string; name_so: string; name_en: string };
type Place = Named & { parent: string; code: string };

interface Props {
  districts: Named[];
  sections: Place[];
  sectors: Place[];
  neighbourhoods: Place[];
  initial: { district: string; section: string; sector: string; nbhd: string };
}

/** District → section → sector → neighbourhood for the report form; each list holds the places under the one above. */
export function AreaFilter({ districts, sections, sectors, neighbourhoods, initial }: Props) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const name = (o: Named) => (locale === "so" ? o.name_so : o.name_en);
  const [district, setDistrict] = useState(initial.district);
  const [section, setSection] = useState(initial.section);
  const [sector, setSector] = useState(initial.sector);
  const [nbhd, setNbhd] = useState(initial.nbhd);
  const sectionList = sections.filter((s) => s.parent === district);
  const sectorList = sectors.filter((s) => s.parent === section);
  const nbhdList = neighbourhoods.filter((n) => n.parent === sector);

  const select = (label: string, field: string, value: string, all: string, list: (Named & { code?: string })[], onChange: (v: string) => void, disabled = false) => (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <NativeSelect name={field} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-40">
        <option value="">{all}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code ? `${o.code} · ${name(o)}` : name(o)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  return (
    <>
      {districts.length > 1
        ? select(t("district"), "district", district, t("allDistricts"), districts, (v) => {
            setDistrict(v);
            setSection("");
            setSector("");
            setNbhd("");
          })
        : district && <input type="hidden" name="district" value={district} />}
      {select(t("section"), "section", section, t("allSections"), sectionList, (v) => {
        setSection(v);
        setSector("");
        setNbhd("");
      }, !district)}
      {select(t("sector"), "sector", sector, t("allSectors"), sectorList, (v) => {
        setSector(v);
        setNbhd("");
      }, !section)}
      {select(t("neighbourhood"), "nbhd", nbhd, t("allNeighbourhoods"), nbhdList, setNbhd, !sector)}
    </>
  );
}
