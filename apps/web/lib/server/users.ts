import "server-only";
import type { UsersQuery } from "@dhulka/core/schemas";
import { unwrap } from "./action";
import { createClient } from "@/lib/supabase/server";

export interface RoleLite {
  id: string;
  key: string | null;
  name_so: string;
  name_en: string;
  colour: string;
  is_system: boolean;
  is_protected: boolean;
  grants_all: boolean;
  data_scope: "own" | "district" | "districts" | "all";
}

export interface UserRow {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "invited" | "suspended" | "deleted";
  last_login_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  all_districts: boolean;
  role_ids: string[];
  district_ids: string[];
  has_totp: boolean;
}

/** PostgREST `or=` filters treat , ( ) as syntax — strip them from user input. */
function sanitize(q: string): string {
  return q.replace(/[,()*%\\]/g, " ").trim();
}

export async function listRoles(): Promise<RoleLite[]> {
  const supabase = await createClient();
  const res = await supabase
    .from("roles")
    .select("id, key, name_so, name_en, colour, is_system, is_protected, grants_all, data_scope")
    .order("is_protected", { ascending: false })
    .order("name_en");
  return unwrap(res, "roles") as RoleLite[];
}

export async function listDistricts(): Promise<{ id: string; code: string; name_so: string; name_en: string }[]> {
  const supabase = await createClient();
  const res = await supabase.from("districts").select("id, code, name_so, name_en").is("deleted_at", null).order("name_so");
  return unwrap(res, "districts") as { id: string; code: string; name_so: string; name_en: string }[];
}

/** Server-paginated staff list (RLS: users.view). Used by the page and the CSV export. */
export async function queryUsers(query: UsersQuery, limitOverride?: number): Promise<{ rows: UserRow[]; total: number }> {
  const supabase = await createClient();
  let req = supabase
    .from("profiles")
    .select("user_id, full_name, email, phone, status, last_login_at, created_at, created_by, all_districts, user_roles(role_id), user_districts(district_id)", {
      count: "exact",
    })
    .eq("kind", "staff");

  req = query.status === "any" ? req.neq("status", "deleted") : req.eq("status", query.status);
  const q = sanitize(query.q);
  if (q) req = req.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (query.roleId) {
    const holders = unwrap(await supabase.from("user_roles").select("user_id").eq("role_id", query.roleId), "role holders") as { user_id: string }[];
    req = req.in("user_id", holders.length ? holders.map((h) => h.user_id) : ["00000000-0000-0000-0000-000000000000"]);
  }

  const size = limitOverride ?? query.pageSize;
  const from = limitOverride ? 0 : (query.page - 1) * query.pageSize;
  const res = await req.order(query.sort, { ascending: query.dir === "asc", nullsFirst: false }).range(from, from + size - 1);
  const data = unwrap(res, "profiles") as Array<
    Omit<UserRow, "role_ids" | "district_ids" | "has_totp" | "created_by_name"> & {
      user_roles: { role_id: string }[];
      user_districts: { district_id: string }[];
    }
  >;

  const ids = data.map((d) => d.user_id);
  const creatorIds = [...new Set(data.map((d) => d.created_by).filter((x): x is string => Boolean(x)))];
  const [mfa, creators] = await Promise.all([
    ids.length ? supabase.rpc("admin_user_mfa_status", { p_user_ids: ids }) : { data: [], error: null },
    creatorIds.length ? supabase.rpc("staff_display_names", { p_user_ids: creatorIds }) : { data: [], error: null },
  ]);
  const mfaMap = new Map(((mfa.data ?? []) as { user_id: string; has_totp: boolean }[]).map((m) => [m.user_id, m.has_totp]));
  const nameMap = new Map(((creators.data ?? []) as { user_id: string; full_name: string }[]).map((c) => [c.user_id, c.full_name]));

  return {
    total: res.count ?? 0,
    rows: data.map(({ user_roles, user_districts, ...u }) => ({
      ...u,
      role_ids: user_roles.map((r) => r.role_id),
      district_ids: user_districts.map((d) => d.district_id),
      has_totp: mfaMap.get(u.user_id) ?? false,
      created_by_name: u.created_by ? (nameMap.get(u.created_by) ?? null) : null,
    })),
  };
}

export async function userStatusCounts(): Promise<Record<"active" | "invited" | "suspended", number>> {
  const supabase = await createClient();
  const count = async (status: string) =>
    (await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("kind", "staff").eq("status", status)).count ?? 0;
  const [active, invited, suspended] = await Promise.all([count("active"), count("invited"), count("suspended")]);
  return { active, invited, suspended };
}

/** role_id → permission keys (RLS: roles.view, or the viewer's own roles). */
export async function rolePermissionMap(): Promise<Record<string, string[]>> {
  const supabase = await createClient();
  const res = await supabase.from("role_permissions").select("role_id, permission_key").limit(10000);
  const out: Record<string, string[]> = {};
  for (const row of (res.data ?? []) as { role_id: string; permission_key: string }[]) {
    (out[row.role_id] ??= []).push(row.permission_key);
  }
  return out;
}
