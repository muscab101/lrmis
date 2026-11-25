import { Badge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { EmptyState, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Trash2 } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import type { DeletedKind } from "./kinds";
import { RestoreButton } from "./restore-button";

export async function generateMetadata() {
  const t = await getTranslations("deleted");
  return { title: t("title") };
}

const TABS = ["all", "land", "owner", "user", "places"] as const;
const PLACES = ["district", "section", "sector", "neighbourhood", "street", "facility"];

type Row = {
  kind: DeletedKind;
  id: string;
  label: string;
  detail: string | null;
  deleted_at: string;
  deleted_by: string | null;
  reason: string | null;
  purge_on: string;
  kept: boolean;
};

/** Everything deleted: bring it back, or let it go for good 3 months after it was deleted. */
export default async function DeletedPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "deleted.view");
  const t = await getTranslations("deleted");
  const format = await getFormatter();
  const { tab: raw } = await searchParams;
  const tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as (typeof TABS)[number]) : "all";
  const supabase = await createClient();
  const { data } = await supabase.rpc("deleted_items", { p_kind: tab === "all" || tab === "places" ? null : tab });
  const rows = ((data ?? []) as Row[]).filter((r) => tab !== "places" || PLACES.includes(r.kind));
  const day = (d: string) => format.dateTime(new Date(`${d.slice(0, 10)}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex flex-wrap gap-6 text-sm" aria-label={t("title")}>
          {TABS.map((x) => (
            <Link key={x} href={x === "all" ? "/deleted" : `/deleted?tab=${x}`} className={tabClass(tab === x)}>
              {t(`tabs.${x}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Trash2 />} title={t("none")} description={t("noneBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("what")}</TableHead>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("deletedOn")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("reason")}</TableHead>
                <TableHead>{t("goesOn")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}>
                  <TableCell className="text-sm">{t(`kinds.${r.kind}`)}</TableCell>
                  <TableCell>
                    <span className="block text-sm font-medium">{r.label}</span>
                    {r.detail && <span className="text-muted-foreground block text-xs">{r.detail}</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {day(r.deleted_at)}
                    {r.deleted_by && <span className="text-muted-foreground block text-xs">{t("by", { name: r.deleted_by })}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-64 text-sm lg:table-cell">{r.reason ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.kept ? <Badge variant="outline">{t("keptMoney")}</Badge> : day(r.purge_on)}
                  </TableCell>
                  <TableCell className="text-end">
                    <RestoreButton kind={r.kind} id={r.id} label={r.label} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
