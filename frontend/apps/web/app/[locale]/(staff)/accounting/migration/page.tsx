import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowLeft, DatabaseZap } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { UploadMigration } from "@/components/accounting/migration/controls";
import { MIGRATION_TONE as STATUS_TONE } from "@/components/accounting/migration/status";
import { Link } from "@/i18n/navigation";
import { listMigrations } from "@/lib/server/acct-migration";
import { requirePermission } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("migration");
  return { title: t("title") };
}

/** Accounting → Migration: every migration so far, and a new one from the old system's file(s). Super Admin only. */
export default async function MigrationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "accounting.view");
  if (!viewer.isSuperAdmin) notFound();
  const t = await getTranslations("migration");
  const format = await getFormatter();
  const rows = await listMigrations();
  return (
    <div className="space-y-5">
      <Link href="/accounting" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft className="size-4" aria-hidden />
        {t("backToAccounting")}
      </Link>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("newTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("newBody")}</p>
        </CardHeader>
        <CardContent>
          <UploadMigration />
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<DatabaseZap />} title={t("none")} description={t("noneBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("filesCol")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    <Link href={`/accounting/migration/${m.id}`} className="hover:text-primary font-medium">
                      {m.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{m.source_files.map((f) => f.name).join(", ")}</TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[m.status]}>{t(`status.${m.status}`)}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-end text-xs">{format.dateTime(new Date(m.created_at), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
