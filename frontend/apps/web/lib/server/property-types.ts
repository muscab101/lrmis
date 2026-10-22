import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** A type of house or land: a Valuation → Property grade, priced in USD per m². */
export interface PropertyTypeRow {
  id: string;
  code: string;
  name_so: string;
  name_en: string;
  price: number;
  currency: string;
  active: boolean;
  sort: number;
}

export async function listPropertyTypes(): Promise<PropertyTypeRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("property_grades").select("id, code, name_so, name_en, amount, active, sort").order("sort").order("name_en");
  const rows = unwrap(res, "property grades") as { id: string; code: string; name_so: string; name_en: string; amount: number; active: boolean; sort: number }[];
  return rows.map(({ amount, ...g }) => ({ ...g, price: Number(amount), currency: "USD" }));
}

/** The type's name in the page language, or null. */
export function propertyTypeName(types: PropertyTypeRow[], code: string | null | undefined, lang: string): string | null {
  const t = code ? types.find((x) => x.code === code) : undefined;
  return t ? (lang === "so" ? t.name_so : t.name_en) : (code ?? null);
}
