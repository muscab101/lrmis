import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { listDistricts } from "./users";

export interface MyScope {
  /** Covers every district. */
  all: boolean;
  districtIds: string[];
  /** Tied to their desk: money reports only ever show that desk. */
  locked: boolean;
  /** The desk the user is assigned to (Admin → Users), if any. */
  pos: { id: string; code: string; name: string; district_id: string | null } | null;
}

/** The signed-in user's districts and point of sale. Cached per request. */
export const myScope = cache(async (): Promise<MyScope> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_scope");
  const d = (data ?? {}) as { all?: boolean; district_ids?: string[] | null; locked?: boolean; pos?: MyScope["pos"] };
  return { all: Boolean(d.all), districtIds: d.district_ids ?? [], locked: Boolean(d.locked), pos: d.pos ?? null };
});

/** The districts the user covers (all of them for district-wide roles), for pickers and filters. */
export async function myDistricts() {
  const [all, scope] = await Promise.all([listDistricts(), myScope()]);
  return scope.all ? all : all.filter((d) => scope.districtIds.includes(d.id));
}

/** Points of sale in the user's districts (the online desk too), for report filters. */
export async function myPointsOfSale() {
  const scope = await myScope();
  if (scope.locked && scope.pos) return [{ ...scope.pos, kind: "cashier" }];
  const supabase = await createClient();
  const { data } = await supabase.from("points_of_sale").select("id, code, name, district_id, kind").order("code");
  const rows = (data ?? []) as { id: string; code: string; name: string; district_id: string | null; kind: string }[];
  return rows.filter((p) => scope.all || p.district_id === null || scope.districtIds.includes(p.district_id));
}
