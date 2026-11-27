/** The office a user works for (public.user_office): worked out from their areas, cash desk or districts. */
export interface Office {
  level: "section" | "sector" | "neighbourhood" | "pos" | "district" | "districts" | "head_office";
  code?: string;
  name_so?: string;
  name_en?: string;
  district_so?: string | null;
  district_en?: string | null;
  /** How many more areas or districts besides the one named. */
  more: number;
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** "Hodan District Office", "Sector K7 · Hodan", "Head Office"… (t = the "office" words). */
export function officeLabel(o: Office | null, locale: string, t: T): string {
  if (!o) return t("head_office");
  const name = (locale === "so" ? o.name_so : o.name_en) ?? "";
  const district = (locale === "so" ? o.district_so : o.district_en) ?? "";
  const more = o.more > 0 ? ` ${t("more", { n: o.more })}` : "";
  switch (o.level) {
    case "pos":
      return name;
    case "district":
      return t("district", { name });
    case "districts":
      return `${t("district", { name })}${more}`;
    case "section":
    case "sector":
    case "neighbourhood":
      return `${t(o.level, { name, code: o.code ?? "" })}${district ? ` · ${district}` : ""}${more}`;
    default:
      return t("head_office");
  }
}
