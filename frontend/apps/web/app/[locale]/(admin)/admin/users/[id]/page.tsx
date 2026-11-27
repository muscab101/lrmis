import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dhulka/ui/form-controls";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { UserStatusBadge } from "@/components/admin/badges";
import { UserForm } from "@/components/admin/user-form";
import { UserPowers } from "@/components/admin/user-powers";
import { TestLoginButton } from "@/components/activity/test-login";
import { Button } from "@dhulka/ui/button";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listRoles, rolePermissionMap } from "@/lib/server/users";
import { userAreas } from "@/lib/server/messages";
import { createClient } from "@/lib/supabase/server";
import { CashDeskCard } from "./cash-desk-card";
import { MessagingAreasCard } from "./messaging-areas-card";
import { OfficeBadge } from "@/components/shell/office-badge";
import { userOffice } from "@/lib/server/office";
import { UserSecurityPanel } from "./security-panel";

export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ created?: string; tab?: string }> }) {
  const { locale, id } = await params;
  const { created, tab } = await searchParams;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "users.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("admin.users");
  const format = await getFormatter();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, kind, full_name, email, phone, status, all_districts, point_of_sale_id, last_login_at, created_at, user_roles(role_id), user_districts(district_id, districts(id, code, name_so, name_en))")
    .eq("user_id", id)
    .eq("kind", "staff")
    .maybeSingle();
  if (!profile) notFound();

  const [roles, rolePermissions, mfa, logins, audit, records, desks, overrides] = await Promise.all([
    listRoles(),
    rolePermissionMap(),
    supabase.rpc("admin_user_mfa_status", { p_user_ids: [id] }),
    supabase.from("login_events").select("id, method, success, reason, ip, user_agent, at").eq("user_id", id).order("at", { ascending: false }).limit(20),
    viewer.can("audit.view")
      ? supabase.from("audit_log").select("id, at, action, actor_email, ip").eq("record_id", id).order("at", { ascending: false }).limit(30)
      : Promise.resolve({ data: null }),
    supabase.rpc("admin_user_record_counts", { p_user_id: id }),
    supabase.from("points_of_sale").select("id, code, name, district_id, districts(name_so, name_en)").eq("active", true).neq("kind", "online").order("code"),
    supabase.from("user_permission_overrides").select("permission_key, allow").eq("user_id", id),
  ]);

  type DistrictJoin = { district_id: string; districts: { id: string; code: string; name_so: string; name_en: string } | null };
  const districts = (profile.user_districts as unknown as DistrictJoin[])
    .map((d) => d.districts)
    .filter((d): d is NonNullable<DistrictJoin["districts"]> => Boolean(d));
  const roleIds = (profile.user_roles as { role_id: string }[]).map((r) => r.role_id);
  const hasTotp = ((mfa.data ?? []) as { has_totp: boolean }[])[0]?.has_totp ?? false;
  const isSelf = id === viewer.user.id;
  const tl = await getTranslations("testLogin");
  const myRoles = roles.filter((r) => roleIds.includes(r.id));
  // A super admin can't be tested as, by anyone.
  const canTest = viewer.isSuperAdmin && !isSelf && ["active", "invited"].includes(profile.status) && !myRoles.some((r) => r.key === "super_admin");
  // Powers: what the roles give, and what was given or taken away for this user only (Super Admin sets these).
  const fromRole = [...new Set(roleIds.flatMap((r) => rolePermissions[r] ?? []))];
  const overrideRows = (overrides.data ?? []) as { permission_key: string; allow: boolean }[];
  const recordTotal = ((records.data ?? {}) as { total?: number }).total ?? 0;
  // Desks the user may work at: those in their districts (all of them for an all-districts account).
  type DeskJoin = { id: string; code: string; name: string; district_id: string | null; districts: { name_so: string; name_en: string } | null };
  const districtIds = new Set(districts.map((d) => d.id));
  const userDesks = ((desks.data ?? []) as unknown as DeskJoin[])
    .filter((d) => profile.all_districts || (d.district_id !== null && districtIds.has(d.district_id)))
    .map((d) => ({ id: d.id, code: d.code, name: d.name, district: d.districts ? (locale === "so" ? d.districts.name_so : d.districts.name_en) : "" }));

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
            <OfficeBadge office={await userOffice(id)} className="mb-1 flex" />
            {profile.email} · {t("lastLogin")}: {profile.last_login_at ? format.dateTime(new Date(profile.last_login_at), { dateStyle: "medium", timeStyle: "short" }) : t("never")}
          </>
        }
      />

      {created && (
        <Card className="mb-6 border-primary">
          <CardHeader>
            <CardTitle>{tl("createdTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{tl("createdBody")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {myRoles.map((r) => (
                <Button key={r.id} asChild variant="outline" size="sm">
                  <Link href={`/admin/roles/${r.id}`}>{locale === "so" ? r.name_so : r.name_en}</Link>
                </Button>
              ))}
              {canTest && <TestLoginButton userId={id} name={profile.full_name || (profile.email ?? "")} size="sm" />}
            </div>
          </CardContent>
        </Card>
      )}
      {!created && canTest && (
        <div className="mb-4 flex justify-end">
          <TestLoginButton userId={id} name={profile.full_name || (profile.email ?? "")} size="sm" />
        </div>
      )}

      <Tabs defaultValue={["powers", "security", "activity"].includes(tab ?? "") ? tab : "overview"}>
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="powers">{t("tabPowers")}</TabsTrigger>
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
          <CashDeskCard userId={id} current={(profile.point_of_sale_id as string | null) ?? null} desks={userDesks} canEdit={viewer.can("users.update")} />
          <MessagingAreasCard
            userId={id}
            canEdit={viewer.can("users.update")}
            initial={(await userAreas(id)).map((a) => ({ level: a.level, id: a.id, code: a.code, name: locale === "so" ? a.name_so : a.name_en }))}
          />
        </TabsContent>

        <TabsContent value="powers">
          <UserPowers
            userId={id}
            fromRole={fromRole}
            allow={overrideRows.filter((o) => o.allow).map((o) => o.permission_key)}
            deny={overrideRows.filter((o) => !o.allow).map((o) => o.permission_key)}
            canEdit={viewer.isSuperAdmin && !isSelf}
            superAdminUser={myRoles.some((r) => r.grants_all)}
          />
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
