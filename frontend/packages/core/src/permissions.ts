/**
 * Permission catalog. Roles are data (stored in Postgres); this file only describes
 * which permission keys exist. The SQL migration `0003_rbac_catalog.sql` seeds the same
 * modules × actions — `test/permissions-catalog.test.ts` fails if the two drift apart.
 */

export const MODULES = [
  "dashboard",
  "map",
  "applications",
  "parcels",
  "owners",
  "surveys",
  "valuation",
  "billing",
  "invoices",
  "payments",
  "cashier",
  "reconciliation",
  "accounting",
  "transfers",
  "disputes",
  "permits",
  "documents",
  "certificates",
  "messages",
  "reports",
  "locations",
  "settings",
  "audit",
  "users",
  "roles",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "approve",
  "cancel",
  "export",
  "print",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Permissions that don't fit the module × action grid. */
export const SPECIAL_PERMISSIONS = [
  "payments.refund",
  "certificates.reprint",
  "map.edit_geometry",
  "users.manage",
  "users.reset_2fa",
  "users.reset_password",
  "users.force_signout",
  "roles.manage",
  "applications.capture_location",
  "parcels.lock",
  "parcels.yet_to_register",
  "certificates.id_cards",
  "certificates.printers",
  "certificates.signature",
  "certificates.design",
  "reports.assistant",
  "parcels.registered",
  "parcels.delete_registered",
  "parcels.demolitions",
  "parcels.demolish",
  "parcels.demolish_approve",
  "owners.registered",
  "owners.delete_registered",
  "messages.broadcast",
  // Parts of the system with their own powers (only the actions they use).
  "apartments.view",
  "apartments.update",
  "managers.view",
  "incomplete.view",
  "points_of_sale.view",
  "points_of_sale.update",
  "chat.view",
  "assistant.view",
  "verify.view",
] as const;
export type SpecialPermission = (typeof SPECIAL_PERMISSIONS)[number];

export type PermissionKey = `${Module}.${Action}` | SpecialPermission;

export const ALL_PERMISSIONS: readonly PermissionKey[] = [
  ...MODULES.flatMap((m) => ACTIONS.map((a) => `${m}.${a}` as const)),
  ...SPECIAL_PERMISSIONS,
];

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function permissionKey(module: Module, action: Action): PermissionKey {
  return `${module}.${action}`;
}

/** Group special permissions under the module they belong to (for the matrix UI). */
export function specialPermissionsFor(module: Module): SpecialPermission[] {
  return SPECIAL_PERMISSIONS.filter((p) => p.startsWith(`${module}.`));
}

export const DATA_SCOPES = ["own", "district", "districts", "all"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

const SCOPE_RANK: Record<DataScope, number> = { own: 0, district: 1, districts: 2, all: 3 };

export function scopeRank(scope: DataScope): number {
  return SCOPE_RANK[scope];
}

/** A user with several roles gets the widest data scope among them. */
export function widestScope(scopes: readonly DataScope[]): DataScope {
  return scopes.reduce<DataScope>((acc, s) => (SCOPE_RANK[s] > SCOPE_RANK[acc] ? s : acc), "own");
}

export interface RoleGrant {
  grantsAll: boolean;
  permissions: readonly string[];
  dataScope: DataScope;
}

/** Effective permissions = union of all roles. A `grantsAll` role (Super Admin) has everything. */
export function effectivePermissions(roles: readonly RoleGrant[]): Set<PermissionKey> {
  if (roles.some((r) => r.grantsAll)) return new Set(ALL_PERMISSIONS);
  const out = new Set<PermissionKey>();
  for (const role of roles) for (const p of role.permissions) if (isPermissionKey(p)) out.add(p);
  return out;
}

/**
 * Privilege-escalation guard (mirrors `assert_can_grant` in SQL): an actor may only grant
 * permissions they hold themselves, and never a scope wider than their own.
 */
export function ungrantablePermissions(
  actor: ReadonlySet<string>,
  requested: readonly string[],
): string[] {
  return requested.filter((p) => !actor.has(p));
}
