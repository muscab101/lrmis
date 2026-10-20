import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** A type of house or land, from the admin's list (Admin → Property types). */
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
  const res = await supabase.from("property_types").select("id, code, name_so, name_en, price, currency, active, sort").order("sort").order("name_en");
  return unwrap(res, "property types") as PropertyTypeRow[];
}

/** The type's name in the page language, or null. */
export function propertyTypeName(types: PropertyTypeRow[], code: string | null | undefined, lang: string): string | null {
  const t = code ? types.find((x) => x.code === code) : undefined;
  return t ? (lang === "so" ? t.name_so : t.name_en) : (code ?? null);
}
