import { PageHeader } from "@dhulka/ui/misc";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RoleForm } from "@/components/admin/role-form";
import { requirePermission } from "@/lib/server/auth";
import { loadRole, myScopeRank } from "../role-loader";

export default async function RolePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "roles.view");
  const t = await getTranslations("admin.roles");
  const role = await loadRole(id);
  if (!role) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={locale === "so" ? role.values.nameSo : role.values.nameEn} description={role.is_system ? t("systemRoleNote") : t("customRoleNote")} />
      <RoleForm
        mode="edit"
        roleId={role.id}
        initial={role.values}
        isSystem={role.is_system}
        isProtected={role.is_protected}
        canEdit={viewer.can("roles.update")}
        isSuperAdmin={viewer.isSuperAdmin}
        myPermissions={[...viewer.permissions]}
        myScopeRank={await myScopeRank()}
      />
    </div>
  );
}
