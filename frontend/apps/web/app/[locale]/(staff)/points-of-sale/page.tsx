import { StatusBadge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";
import { PosActions, type PosRow } from "./pos-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin.pos");
  return { title: t("title") };
}

/** Revenue: the cash desks of each district, and the cashiers working at each. Editing needs settings.update. */
export default async function PointsOfSalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "points_of_sale.view");
  const t = await getTranslations("admin.pos");
  const supabase = await createClient();
  const [{ data: rows }, districts, { data: cashiers }] = await Promise.all([
    supabase.from("points_of_sale").select("id, code, name, district_id, kind, receipt_prefix, active").neq("kind", "online").order("code"),
    listDistricts(),
    supabase.from("profiles").select("full_name, email, point_of_sale_id").eq("kind", "staff").is("deleted_at", null).not("point_of_sale_id", "is", null),
  ]);
  const canEdit = viewer.can("points_of_sale.update") || viewer.can("settings.update");
  const districtName = new Map(districts.map((d) => [d.id, locale === "so" ? d.name_so : d.name_en]));
  const staffAt = new Map<string, string[]>();
  for (const c of cashiers ?? []) {
    const list = staffAt.get(c.point_of_sale_id as string) ?? [];
    list.push((c.full_name as string) || (c.email as string) || "—");
    staffAt.set(c.point_of_sale_id as string, list);
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={canEdit && <PosActions districts={districts} />} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("code")}</TableHead>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("district")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("cashiers")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("status")}</TableHead>
              {canEdit && <TableHead className="text-end">{t("actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {((rows ?? []) as PosRow[]).map((p) => (
              <TableRow key={p.id} className={p.active ? undefined : "text-muted-foreground"}>
                <TableCell>
                  <Mono>{p.code}</Mono>
                </TableCell>
                <TableCell className="text-sm">
                  {p.name}
                  {p.kind === "field" && <span className="text-muted-foreground ms-2 text-xs">{t("kinds.field")}</span>}
                </TableCell>
                <TableCell className="text-sm">{(p.district_id && districtName.get(p.district_id)) || "—"}</TableCell>
                <TableCell className="hidden text-sm md:table-cell">{staffAt.get(p.id)?.join(", ") ?? <span className="text-muted-foreground">{t("noCashier")}</span>}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge tone={p.active ? "approved" : "draft"}>{p.active ? t("active") : t("off")}</StatusBadge>
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <PosActions pos={p} districts={districts} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
