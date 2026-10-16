import { Badge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Lock, Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RoleBadge } from "@/components/admin/badges";
import { Link } from "@/i18n/navigation";
import { unwrap } from "@/lib/server/action";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { RoleRowActions } from "./role-row-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin.roles");
  return { title: t("title") };
}

interface RoleRow {
  id: string;
  key: string | null;
  name_so: string;
  name_en: string;
  description: string;
  colour: string;
  is_system: boolean;
  is_protected: boolean;
  grants_all: boolean;
  data_scope: "own" | "district" | "districts" | "all";
  role_permissions: { count: number }[];
}

export default async function RolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "roles.view");
  const t = await getTranslations("admin.roles");
  const tu = await getTranslations("admin.users");
  const supabase = await createClient();
  const [rolesRes, countsRes] = await Promise.all([
    supabase
      .from("roles")
      .select("id, key, name_so, name_en, description, colour, is_system, is_protected, grants_all, data_scope, role_permissions(count)")
      .order("is_protected", { ascending: false })
      .order("is_system", { ascending: false })
      .order("name_en"),
    supabase.rpc("admin_role_user_counts"),
  ]);
  const roles = unwrap(rolesRes, "roles") as unknown as RoleRow[];
  const counts = new Map(((countsRes.data ?? []) as { role_id: string; users: number }[]).map((c) => [c.role_id, Number(c.users)]));
  const options = roles.filter((r) => !r.grants_all).map((r) => ({ id: r.id, label: locale === "so" ? r.name_so : r.name_en }));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          viewer.can("roles.create") && (
            <Button asChild>
              <Link href="/admin/roles/new">
                <Plus aria-hidden />
                {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colRole")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("colDescription")}</TableHead>
              <TableHead>{t("colType")}</TableHead>
              <TableHead>{t("colScope")}</TableHead>
              <TableHead className="text-end">{t("colPermissions")}</TableHead>
              <TableHead className="text-end">{t("colUsers")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("colActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/admin/roles/${r.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <RoleBadge role={r} />
                    {r.is_protected && <Lock className="size-3.5 text-muted-foreground" aria-label={t("protected")} />}
                  </Link>
                </TableCell>
                <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground lg:table-cell">{r.description}</TableCell>
                <TableCell>
                  <Badge variant={r.is_system ? "muted" : "accent"}>{r.is_system ? t("system") : t("custom")}</Badge>
                </TableCell>
                <TableCell className="text-xs">{tu(`scope.${r.data_scope}`)}</TableCell>
                <TableCell className="text-end text-xs">{r.grants_all ? t("allPermissions") : (r.role_permissions[0]?.count ?? 0)}</TableCell>
                <TableCell className="text-end">
                  <Link href={`/admin/users?roleId=${r.id}`} className="text-primary hover:underline">
                    {counts.get(r.id) ?? 0}
                  </Link>
                </TableCell>
                <TableCell>
                  <RoleRowActions
                    role={{ id: r.id, name: locale === "so" ? r.name_so : r.name_en, isSystem: r.is_system, isProtected: r.is_protected, users: counts.get(r.id) ?? 0 }}
                    moveOptions={options.filter((o) => o.id !== r.id)}
                    can={{ create: viewer.can("roles.create"), update: viewer.can("roles.update"), remove: viewer.can("roles.delete") }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
