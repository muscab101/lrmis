import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { UserForm } from "@/components/admin/user-form";
import { requirePermission } from "@/lib/server/auth";
import { listRoles, rolePermissionMap } from "@/lib/server/users";

export async function generateMetadata() {
  const t = await getTranslations("admin.users");
  return { title: t("new") };
}

export default async function NewUserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "users.create");
  const t = await getTranslations("admin.users");
  const [roles, rolePermissions] = await Promise.all([listRoles(), rolePermissionMap()]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("new")} description={t("newSubtitle")} />
      <UserForm
        mode="create"
        roles={roles.filter((r) => r.key !== "citizen")}
        myPermissions={[...viewer.permissions]}
        rolePermissions={rolePermissions}
        isSuperAdmin={viewer.isSuperAdmin}
      />
    </div>
  );
}
