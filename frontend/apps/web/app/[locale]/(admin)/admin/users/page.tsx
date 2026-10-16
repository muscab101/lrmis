import { usersQuerySchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { KpiChip, PageHeader } from "@dhulka/ui/misc";
import { Download, UserPlus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts, listRoles, queryUsers, userStatusCounts } from "@/lib/server/users";
import { UsersTable } from "./users-table";

export async function generateMetadata() {
  const t = await getTranslations("admin.users");
  return { title: t("title") };
}

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "users.view");
  const t = await getTranslations("admin.users");
  const query = usersQuerySchema.parse(await searchParams);
  const [{ rows, total }, counts, roles, districts] = await Promise.all([queryUsers(query), userStatusCounts(), listRoles(), listDistricts()]);

  const exportHref = `/api/exports/users?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            {viewer.can("users.export") && (
              <Button variant="outline" asChild>
                <a href={exportHref}>
                  <Download aria-hidden />
                  {t("export")}
                </a>
              </Button>
            )}
            {viewer.can("users.create") && (
              <Button asChild>
                <Link href="/admin/users/new">
                  <UserPlus aria-hidden />
                  {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap gap-3">
          <KpiChip label={t("kpiActive")} value={counts.active} tone="success" />
          <KpiChip label={t("kpiInvited")} value={counts.invited} />
          <KpiChip label={t("kpiSuspended")} value={counts.suspended} tone={counts.suspended ? "danger" : "default"} />
        </div>
      </PageHeader>
      <UsersTable rows={rows} total={total} query={query} roles={roles} districts={districts} />
    </>
  );
}
