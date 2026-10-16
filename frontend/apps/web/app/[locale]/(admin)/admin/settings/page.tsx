import { Card } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.view");
  const t = await getTranslations("admin.settings");
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value, description, updated_at").order("key");
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Alert tone="info" className="mb-4">
        {t("readOnlyNote")}
      </Alert>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("key")}</TableHead>
              <TableHead>{t("value")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("description")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {((data ?? []) as { key: string; value: unknown; description: string }[]).map((s) => (
              <TableRow key={s.key}>
                <TableCell>
                  <Mono className="text-xs">{s.key}</Mono>
                </TableCell>
                <TableCell>
                  <Mono className="text-xs break-all">{JSON.stringify(s.value)}</Mono>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{s.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
