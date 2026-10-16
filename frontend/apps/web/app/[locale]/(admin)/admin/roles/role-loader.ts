import "server-only";
import type { RoleInput } from "@dhulka/core/schemas";
import { createClient } from "@/lib/supabase/server";

export interface LoadedRole {
  id: string;
  key: string | null;
  is_system: boolean;
  is_protected: boolean;
  values: RoleInput;
}

export async function loadRole(id: string): Promise<LoadedRole | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("id, key, name_so, name_en, description, colour, is_system, is_protected, data_scope, limits, role_permissions(permission_key)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const limits = (data.limits ?? {}) as { maxWaiverAmount?: number; maxRefundAmount?: number };
  return {
    id: data.id,
    key: data.key,
    is_system: data.is_system,
    is_protected: data.is_protected,
    values: {
      nameSo: data.name_so,
      nameEn: data.name_en,
      description: data.description,
      colour: data.colour.toUpperCase(),
      dataScope: data.data_scope,
      permissions: (data.role_permissions as { permission_key: string }[]).map((p) => p.permission_key).sort(),
      limits: { maxWaiverAmount: limits.maxWaiverAmount ?? null, maxRefundAmount: limits.maxRefundAmount ?? null },
    },
  };
}

export async function myScopeRank(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase.from("user_roles").select("roles(data_scope)").eq("user_id", user.id);
  const rank = { own: 0, district: 1, districts: 2, all: 3 } as Record<string, number>;
  return Math.max(0, ...((data ?? []) as unknown as { roles: { data_scope: string } | null }[]).map((r) => rank[r.roles?.data_scope ?? "own"] ?? 0));
}
