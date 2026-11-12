import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { History, UserRound } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Pager } from "@/components/admin/pager";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { tabClass } from "@/components/shell/tabs";

const PAGE = 50;
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  result: z.enum(["all", "success", "failure"]).default("all"),
});

export default async function LoginHistoryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "audit.view");
  const t = await getTranslations("admin.loginHistory");
  const format = await getFormatter();
  const q = querySchema.parse(await searchParams);
  const supabase = await createClient();

  let req = supabase.from("login_events").select("id, email, method, success, reason, ip, user_agent, at", { count: "exact" });
  if (q.result !== "all") req = req.eq("success", q.result === "success");
  const { data, count } = await req.order("at", { ascending: false }).range((q.page - 1) * PAGE, q.page * PAGE - 1);
  const rows = (data ?? []) as { id: number; email: string | null; method: string; success: boolean; reason: string | null; ip: string | null; user_agent: string | null; at: string }[];

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex gap-6 text-sm" aria-label={t("filter")}>
          {(["all", "success", "failure"] as const).map((r) => (
            <Link
              key={r}
              href={`/admin/login-history?result=${r}`}
              className={tabClass(q.result === r)}
              aria-current={q.result === r ? "page" : undefined}
            >
              {t(`result_${r}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<History />} title={t("empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("when")}</TableHead>
                <TableHead>{t("who")}</TableHead>
                <TableHead>{t("method")}</TableHead>
                <TableHead>{t("result")}</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="hidden xl:table-cell">{t("device")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "medium" })}</TableCell>
                  <TableCell className="text-sm">{e.email ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.method}</TableCell>
                  <TableCell>
                    <StatusBadge tone={e.success ? "approved" : "rejected"}>{e.success ? t("ok") : (e.reason ?? t("failed"))}</StatusBadge>
                  </TableCell>
                  <TableCell>
                    <Mono className="text-xs">{e.ip ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground xl:table-cell">{e.user_agent}</TableCell>
                  <TableCell>
                    {e.email && (
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                          <Link href={`/admin/users?${new URLSearchParams({ q: e.email })}`} aria-label={t("viewUser")} title={t("viewUser")}>
                            <UserRound aria-hidden />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={q.page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} href={(p) => `/admin/login-history?result=${q.result}&page=${p}`} />
      </Card>
    </>
  );
}
