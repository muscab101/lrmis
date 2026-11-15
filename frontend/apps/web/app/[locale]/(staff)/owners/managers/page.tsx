import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { UserCog } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { AutoSubmitForm } from "@/components/forms/auto-submit-form";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listManagers } from "@/lib/server/apartments";

export async function generateMetadata() {
  const t = await getTranslations("managers");
  return { title: t("title") };
}

/** Managers: the person each apartment building names as its manager, their buildings and what those still owe. */
export default async function ManagersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "managers.view");
  const t = await getTranslations("managers");
  const format = await getFormatter();
  const lang = await getLocale();
  const q = ((await searchParams).q ?? "").slice(0, 40);
  const { managers } = await listManagers(lang, q);
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const building = (b: { pun: string | null; house_no: string | null }) => b.pun ?? b.house_no ?? "—";

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="overflow-hidden">
        <AutoSubmitForm className="flex flex-wrap items-center gap-3 border-b p-3">
          <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="max-w-md" />
          <span className="text-muted-foreground ms-auto text-xs">{t("count", { count: managers.length })}</span>
        </AutoSubmitForm>
        {managers.length === 0 ? (
          <EmptyState icon={<UserCog />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("manager")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
                <TableHead>{t("buildings")}</TableHead>
                <TableHead className="text-end">{t("owed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managers.map((m) => (
                <TableRow key={m.partyId ?? `${m.name}-${m.phone}`}>
                  <TableCell className="text-sm font-medium">
                    {m.partyId ? (
                      <Link href={`/owners/${m.partyId}`} className="hover:text-primary">
                        {m.name}
                      </Link>
                    ) : (
                      m.name
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{m.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {m.buildings.map((b) => (
                        <Link key={b.id} href={`/apartments/${b.id}`} className="hover:text-primary">
                          <Mono>{building(b)}</Mono>
                          {b.neighbourhood && <span className="text-muted-foreground text-xs"> · {b.neighbourhood}</span>}
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className={`text-end text-sm tabular-nums ${m.owed > 0 ? "" : "text-muted-foreground"}`}>{m.owed > 0 ? usd(m.owed) : t("paid")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

    </>
  );
}
