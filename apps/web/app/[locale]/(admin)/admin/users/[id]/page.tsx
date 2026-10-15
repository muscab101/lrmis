import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dhulka/ui/form-controls";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { UserStatusBadge } from "@/components/admin/badges";
import { UserForm } from "@/components/admin/user-form";
import { requirePermission } from "@/lib/server/auth";
import { listRoles, rolePermissionMap } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";
import { UserSecurityPanel } from "./security-panel";

export default async function UserDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "users.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("admin.users");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, kind, full_name, email, phone, status, all_districts, last_login_at, created_at, user_roles(role_id), user_districts(district_id, districts(id, code, name_so, name_en))")
    .eq("user_id", id)
    .eq("kind", "staff")
    .maybeSingle();
  if (!profile) notFound();

  const [roles, rolePermissions, mfa, logins, audit, records] = await Promise.all([
    listRoles(),
    rolePermissionMap(),
    supabase.rpc("admin_user_mfa_status", { p_user_ids: [id] }),
    supabase.from("login_events").select("id, method, success, reason, ip, user_agent, at").eq("user_id", id).order("at", { ascending: false }).limit(20),
    viewer.can("audit.view")
      ? supabase.from("audit_log").select("id, at, action, actor_email, ip").eq("record_id", id).order("at", { ascending: false }).limit(30)
      : Promise.resolve({ data: null }),
    supabase.rpc("admin_user_record_counts", { p_user_id: id }),
  ]);

  type DistrictJoin = { district_id: string; districts: { id: string; code: string; name_so: string; name_en: string } | null };
  const districts = (profile.user_districts as unknown as DistrictJoin[])
    .map((d) => d.districts)
    .filter((d): d is NonNullable<DistrictJoin["districts"]> => Boolean(d));
  const roleIds = (profile.user_roles as { role_id: string }[]).map((r) => r.role_id);
  const hasTotp = ((mfa.data ?? []) as { has_totp: boolean }[])[0]?.has_totp ?? false;
  const isSelf = id === viewer.user.id;
  const recordTotal = ((records.data ?? {}) as { total?: number }).total ?? 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {profile.full_name || profile.email}
            <UserStatusBadge status={profile.status} />
          </span>
        }
        description={
          <>
            {profile.email} · {t("lastLogin")}: {profile.last_login_at ? format.dateTime(new Date(profile.last_login_at), { dateStyle: "medium", timeStyle: "short" }) : t("never")}
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="security">{t("tabSecurity")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabActivity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {viewer.can("users.update") ? (
            <UserForm
              mode="edit"
              roles={roles.filter((r) => r.key !== "citizen")}
              myPermissions={[...viewer.permissions]}
              rolePermissions={rolePermissions}
              isSuperAdmin={viewer.isSuperAdmin}
              isSelf={isSelf}
              initial={{
                userId: id,
                fullName: profile.full_name,
                email: profile.email ?? "",
                phone: profile.phone ?? "",
                roleIds,
                allDistricts: profile.all_districts,
                districts: districts.map((d) => ({ value: d.id, label: locale === "so" ? d.name_so : d.name_en, hint: d.code })),
              }}
            />
          ) : (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">{t("readOnly")}</CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="security">
          <UserSecurityPanel
            userId={id}
            email={profile.email ?? ""}
            status={profile.status}
            hasTotp={hasTotp}
            isSelf={isSelf}
            canHardDelete={viewer.isSuperAdmin && recordTotal === 0}
            perms={{
              manage: viewer.can("users.manage"),
              resetPassword: viewer.can("users.reset_password"),
              reset2fa: viewer.can("users.reset_2fa"),
              forceSignout: viewer.can("users.force_signout"),
              remove: viewer.can("users.delete"),
              invite: viewer.can("users.create"),
            }}
          />
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("loginHistory")}</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colWhen")}</TableHead>
                  <TableHead>{t("colMethod")}</TableHead>
                  <TableHead>{t("colResult")}</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((logins.data ?? []) as { id: number; method: string; success: boolean; reason: string | null; ip: string | null; at: string }[]).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell className="text-xs">{e.method}</TableCell>
                    <TableCell>
                      <StatusBadge tone={e.success ? "approved" : "rejected"}>{e.success ? t("success") : (e.reason ?? t("failed"))}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-xs">{e.ip ?? "—"}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {audit.data && (
            <Card>
              <CardHeader>
                <CardTitle>{t("auditTrail")}</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colWhen")}</TableHead>
                    <TableHead>{t("colAction")}</TableHead>
                    <TableHead>{t("colActor")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(audit.data as { id: number; at: string; action: string; actor_email: string | null }[]).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{format.dateTime(new Date(a.at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                      <TableCell>
                        <Mono className="text-xs">{a.action}</Mono>
                      </TableCell>
                      <TableCell className="text-xs">{a.actor_email ?? t("system")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
