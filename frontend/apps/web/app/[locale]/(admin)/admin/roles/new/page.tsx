import { PageHeader } from "@dhulka/ui/misc";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RoleForm } from "@/components/admin/role-form";
import { requirePermission } from "@/lib/server/auth";
import { loadRole, myScopeRank } from "../role-loader";

export default async function NewRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ copy?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "roles.create");
  const t = await getTranslations("admin.roles");
  const { copy } = await searchParams;
  const source = copy ? await loadRole(copy) : null;
  const copySuffix = t("copySuffix");

  const initial = source && !source.is_protected
    ? { ...source.values, nameSo: `${source.values.nameSo} ${copySuffix}`, nameEn: `${source.values.nameEn} (copy)` }
    : {
        nameSo: "",
        nameEn: "",
        description: "",
        colour: "#0EA5A4",
        dataScope: "district" as const,
        permissions: [],
        limits: { maxWaiverAmount: null, maxRefundAmount: null },
      };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={source ? t("copyTitle", { name: locale === "so" ? source.values.nameSo : source.values.nameEn }) : t("new")} description={t("newSubtitle")} />
      <RoleForm
        mode="create"
        initial={initial}
        canEdit
        isSuperAdmin={viewer.isSuperAdmin}
        myPermissions={[...viewer.permissions]}
        myScopeRank={await myScopeRank()}
      />
    </div>
  );
}
