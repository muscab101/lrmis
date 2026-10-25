import { ALL_PERMISSIONS, type Module } from "@dhulka/core/permissions";
import { PageHeader } from "@dhulka/ui/misc";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PermissionCatalog, type CatalogGroup, type CatalogRole } from "@/components/admin/permission-catalog";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

/** Modules in menu order, under the menu group they belong to. */
const GROUPS: { key: string; modules: Module[] }[] = [
  { key: "overview", modules: ["dashboard", "map"] },
  { key: "land", modules: ["applications", "surveys", "owners", "parcels"] },
  { key: "revenue", modules: ["valuation", "billing", "invoices", "payments", "reconciliation", "cashier", "accounting"] },
  { key: "legal", modules: ["transfers", "disputes", "permits", "certificates", "documents"] },
  { key: "insight", modules: ["reports", "messages", "locations"] },
  { key: "admin", modules: ["users", "roles", "audit", "settings"] },
];

/**
 * The permissions that work in the system, explained: what each lets someone do and which roles have it.
 * Only keys with a description (`permissions.what.*`) are shown; the rest of the module × action grid does nothing.
 */
export default async function PermissionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "roles.view");
  const [t, tn, ta, lang] = await Promise.all([getTranslations("permissions"), getTranslations("nav"), getTranslations("admin.permissionsPage"), getLocale()]);
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("name_so, name_en, colour, grants_all, role_permissions(permission_key)").eq("grants_all", false);
  const holders = new Map<string, CatalogRole[]>();
  for (const r of (data ?? []) as (CatalogRole & { role_permissions: { permission_key: string }[] })[]) {
    for (const p of r.role_permissions) holders.set(p.permission_key, [...(holders.get(p.permission_key) ?? []), { name_so: r.name_so, name_en: r.name_en, colour: r.colour }]);
  }
  const byName = (a: CatalogRole, b: CatalogRole) => (lang === "so" ? a.name_so.localeCompare(b.name_so) : a.name_en.localeCompare(b.name_en));

  let total = 0;
  const groups: CatalogGroup[] = GROUPS.map((g) => ({
    label: tn(`groups.${g.key}`),
    modules: g.modules
      .map((m) => ({
        label: t(`modules.${m}`),
        rows: ALL_PERMISSIONS.filter((k) => k.startsWith(`${m}.`) && t.has(`what.${k}`)).map((k) => ({
          key: k,
          what: t(`what.${k}`),
          roles: (holders.get(k) ?? []).sort(byName),
        })),
      }))
      .filter((m) => m.rows.length > 0),
  }));
  for (const g of groups) for (const m of g.modules) total += m.rows.length;

  return (
    <>
      <PageHeader title={ta("title")} description={ta("subtitle")} />
      <PermissionCatalog groups={groups} total={total} />
    </>
  );
}
