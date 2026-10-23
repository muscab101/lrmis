import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ExternalLink, History, ScrollText } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Pager } from "@/components/admin/pager";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditFilters } from "./audit-filters";

const PAGE = 50;

/** Where an audited record lives in the app (tables without their own page have no Open). */
const RECORD_PAGE: Record<string, string> = {
  parcels: "/parcels/",
  applications: "/applications/",
  invoices: "/invoices/",
  payments: "/payments/",
  parties: "/owners/",
  issued_documents: "/documents/",
  transfers: "/transfers/",
  billing_runs: "/billing/runs/",
  profiles: "/admin/users/",
};
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  action: z.string().max(60).default(""),
  table: z.string().max(60).default(""),
  record: z.string().max(60).default(""),
});

function diffKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before || !after) return [];
  return Object.keys({ ...before, ...after }).filter(
    (k) => k !== "updated_at" && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "audit.view");
  const t = await getTranslations("audit");
  const format = await getFormatter();
  const q = querySchema.parse(await searchParams);
  const supabase = await createClient();

  let req = supabase.from("audit_log").select("id, at, actor_email, action, table_name, record_id, before, after, ip, request_id", { count: "exact" });
  if (q.action) req = req.ilike("action", `${q.action.replace(/[%_]/g, "")}%`);
  if (q.table) req = req.eq("table_name", q.table);
  if (q.record) req = req.eq("record_id", q.record);
  const { data, count } = await req.order("at", { ascending: false }).range((q.page - 1) * PAGE, q.page * PAGE - 1);
  const rows = (data ?? []) as {
    id: number;
    at: string;
    actor_email: string | null;
    action: string;
    table_name: string | null;
    record_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    ip: string | null;
    request_id: string | null;
  }[];
  const qs = (p: number) => `/audit?${new URLSearchParams({ ...q, page: String(p) })}`;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <AuditFilters action={q.action} table={q.table} record={q.record} />
      </PageHeader>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText />} title={t("empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("when")}</TableHead>
                <TableHead>{t("actor")}</TableHead>
                <TableHead>{t("action")}</TableHead>
                <TableHead>{t("record")}</TableHead>
                <TableHead>{t("changes")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const changed = diffKeys(r.before, r.after);
                return (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="text-xs whitespace-nowrap">{format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "medium" })}</TableCell>
                    <TableCell className="text-xs">
                      {r.actor_email ?? t("system")}
                      {r.ip && <div className="font-mono text-[11px] text-muted-foreground">{r.ip}</div>}
                    </TableCell>
                    <TableCell>
                      <Mono className="text-xs">{r.action}</Mono>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.table_name}
                      {r.record_id && <div className="font-mono text-[11px] text-muted-foreground">{r.record_id.slice(0, 8)}</div>}
                    </TableCell>
                    <TableCell className="max-w-md text-xs">
                      <details>
                        <summary className="cursor-pointer text-primary">
                          {changed.length ? t("fieldsChanged", { fields: changed.slice(0, 4).join(", ") }) : t("viewDetails")}
                        </summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(r.before, null, 2) ?? "—"}</pre>
                          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(r.after, null, 2) ?? "—"}</pre>
                        </div>
                        {r.request_id && <p className="mt-1 text-[11px] text-muted-foreground">request {r.request_id}</p>}
                      </details>
                    </TableCell>
                    <TableCell>
                      {/* Open the record itself, or see every change to it. */}
                      {r.record_id && (
                        <div className="flex justify-end gap-0.5">
                          {r.table_name && RECORD_PAGE[r.table_name] && (
                            <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                              <Link href={`${RECORD_PAGE[r.table_name]}${r.record_id}`} aria-label={t("openRecord")} title={t("openRecord")}>
                                <ExternalLink aria-hidden />
                              </Link>
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link href={`/audit?${new URLSearchParams({ record: r.record_id })}`} aria-label={t("recordHistory")} title={t("recordHistory")}>
                              <History aria-hidden />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pager page={q.page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} href={qs} />
      </Card>
    </>
  );
}
