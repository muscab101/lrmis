import { Card } from "@dhulka/ui/card";
import { Button } from "@dhulka/ui/button";
import { Input } from "@dhulka/ui/input";
import { EmptyState, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Activity } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { removeExpiredRecordings } from "@/lib/server/recordings";
import { createClient } from "@/lib/supabase/server";
import { actionWords, ONLINE_MS, validDay } from "./words";

interface Row {
  user_id: string;
  full_name: string | null;
  email: string | null;
  status: string;
  roles_so: string[];
  roles_en: string[];
  last_seen: string | null;
  pages: number;
  actions: number;
  last_action: string | null;
  last_table: string | null;
  last_action_at: string | null;
  recordings: number;
}

export async function generateMetadata() {
  const t = await getTranslations("staffActivity");
  return { title: t("title") };
}

export default async function StaffActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "audit.view");
  const t = await getTranslations("staffActivity");
  const format = await getFormatter();
  const day = validDay((await searchParams).day);
  void removeExpiredRecordings();
  const supabase = await createClient();
  const { data } = await supabase.rpc("staff_activity_list", { p_day: day });
  const rows = (data ?? []) as Row[];
  const now = Date.now();

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <form method="get" className="flex flex-wrap items-center gap-2">
          {viewer.isSuperAdmin && (
            <Button asChild size="sm">
              <Link href="/admin/activity/live">{t("live")}</Link>
            </Button>
          )}
          <Input
            type="date"
            name="day"
            defaultValue={day ?? ""}
            aria-label={t("day")}
            className="w-44"
          />
          <Button type="submit" variant="outline" size="sm">
            {t("show")}
          </Button>
        </form>
      </PageHeader>
      {rows.length === 0 ? (
        <EmptyState icon={<Activity aria-hidden />} title={t("none")} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colPerson")}</TableHead>
                <TableHead>{t("colSeen")}</TableHead>
                <TableHead className="text-end">{t("colPages")}</TableHead>
                <TableHead className="text-end">{t("colActions")}</TableHead>
                <TableHead>{t("colLast")}</TableHead>
                <TableHead className="text-end">{t("colRecordings")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const seen = r.last_seen ? new Date(r.last_seen) : null;
                const online = !!seen && now - seen.getTime() < ONLINE_MS;
                const roles = locale === "so" ? r.roles_so : r.roles_en;
                return (
                  <TableRow key={r.user_id}>
                    <TableCell>
                      <Link
                        href={`/admin/activity/${r.user_id}${day ? `?day=${day}` : ""}`}
                        className="font-medium hover:underline"
                      >
                        {r.full_name || r.email}
                      </Link>
                      <p className="text-muted-foreground text-xs">{roles.join(", ") || "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {online ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
                          <span className="bg-success size-2 rounded-full" aria-hidden />
                          {t("online")}
                        </span>
                      ) : seen ? (
                        format.dateTime(seen, { dateStyle: "medium", timeStyle: "short" })
                      ) : (
                        <span className="text-muted-foreground">{t("notSeen")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.pages}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.actions}</TableCell>
                    <TableCell className="text-sm">
                      {r.last_action_at ? (
                        <>
                          {actionWords(t, r.last_action, r.last_table)}
                          <p className="text-muted-foreground text-xs">
                            {format.dateTime(new Date(r.last_action_at), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.recordings}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
