import { StatusBadge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { FeeActions } from "./fee-actions";

export async function generateMetadata() {
  const t = await getTranslations("admin.fees");
  return { title: t("title") };
}

/** Admin: the fixed fees, e.g. the new registration fee billed when new land is submitted. */
export default async function FeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "settings.view");
  const t = await getTranslations("admin.fees");
  const format = await getFormatter();
  const supabase = await createClient();
  const { data } = await supabase.from("fee_types").select("id, code, name_so, name_en, interval, amount, active, sort").order("sort");
  // The registration fee first: it's the one billed with new land.
  const fees = (data ?? []).sort((a, b) => Number(b.code === "registration_fee") - Number(a.code === "registration_fee"));
  const canEdit = viewer.can("settings.update");
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead className="text-end">{t("amount")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("status")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("code")}</TableHead>
              {canEdit && <TableHead className="text-end">{t("actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {fees.map((f) => {
              const name = locale === "so" ? f.name_so : f.name_en;
              const bill = f.code === "property_bill";
              return (
                <TableRow key={f.id} className={f.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <div className="font-medium">{name}</div>
                    {f.code === "registration_fee" && <div className="text-muted-foreground text-xs">{t("registrationHint")}</div>}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {bill ? (
                      <Link href="/admin/property-types" className="text-primary text-sm hover:underline">
                        {t("billFromTypes")}
                      </Link>
                    ) : (
                      usd(Number(f.amount))
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusBadge tone={f.active ? "approved" : "draft"}>{f.active ? t("active") : t("off")}</StatusBadge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Mono className="text-xs">{f.code}</Mono>
                  </TableCell>
                  {canEdit && <TableCell>{!bill && <FeeActions fee={{ id: f.id, name, amount: Number(f.amount), active: f.active }} />}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
