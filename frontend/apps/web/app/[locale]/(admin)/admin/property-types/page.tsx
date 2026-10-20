import { StatusBadge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { House } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { listPropertyTypes } from "@/lib/server/property-types";
import { PropertyTypeActions } from "./property-type-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin.propertyTypes");
  return { title: t("title") };
}

/** Admin: the types of house / land staff choose from when they add land, with their prices. */
export default async function PropertyTypesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "settings.view");
  const t = await getTranslations("admin.propertyTypes");
  const format = await getFormatter();
  const types = await listPropertyTypes();
  const canEdit = viewer.can("settings.update");

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={canEdit && <PropertyTypeActions />} />
      <Card className="overflow-hidden">
        {types.length === 0 ? (
          <EmptyState icon={<House />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="text-end">{t("price")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("status")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("code")}</TableHead>
                {canEdit && <TableHead className="text-end">{t("actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((p) => (
                <TableRow key={p.id} className={p.active ? undefined : "text-muted-foreground"}>
                  <TableCell className="font-medium">{locale === "so" ? p.name_so : p.name_en}</TableCell>
                  <TableCell className="text-end tabular-nums">{format.number(Number(p.price), { style: "currency", currency: p.currency })}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusBadge tone={p.active ? "approved" : "draft"}>{p.active ? t("active") : t("hiddenLabel")}</StatusBadge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Mono className="text-xs">{p.code}</Mono>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <PropertyTypeActions type={p} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
