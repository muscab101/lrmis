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
import { OwnersTabs } from "@/components/shell/section-tabs";
import { ManagerRowActions } from "@/components/owners/manager-row-actions";
import { PARTY_COLUMNS, type PartyRow } from "@/lib/server/applications";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("managers");
  return { title: t("title") };
}

/** Managers: the person each apartment building names as its manager, their buildings and what those still owe. */
export default async function ManagersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "managers.view");
  const to = await getTranslations("owners");
  const t = await getTranslations("managers");
  const format = await getFormatter();
  const lang = await getLocale();
  const q = ((await searchParams).q ?? "").slice(0, 40);
  const { managers } = await listManagers(lang, q);
  // The managers' full records (for Edit) and the districts the owner form offers.
  const ids = managers.map((m) => m.partyId).filter((x): x is string => !!x);
  const [{ data: partyRows }, districts] = await Promise.all([
    ids.length ? (await createClient()).from("parties").select(PARTY_COLUMNS).in("id", ids) : Promise.resolve({ data: [] }),
    listDistricts(),
  ]);
  const parties = new Map(((partyRows ?? []) as unknown as PartyRow[]).map((p) => [p.id, p]));
  const can = {
    edit: viewer.can("owners.update"),
    change: viewer.can("apartments.update") || viewer.can("parcels.update") || viewer.can("valuation.update"),
  };
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const building = (b: { pun: string | null; house_no: string | null }) => b.pun ?? b.house_no ?? "—";

  return (
    <>
      {/* A tab of Owners: Partial registration · Registered · Managers. */}
      <PageHeader title={to("title")} description={t("subtitle")}>
        <OwnersTabs viewer={viewer} active="managers" />
      </PageHeader>
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
                <TableHead className="text-end">{t("actions")}</TableHead>
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
                  <TableCell>
                    <ManagerRowActions
                      partyId={m.partyId}
                      party={m.partyId ? (parties.get(m.partyId) ?? null) : null}
                      buildings={m.buildings.map((b) => ({ id: b.id, label: `${building(b)}${b.neighbourhood ? ` · ${b.neighbourhood}` : ""}` }))}
                      districts={districts}
                      can={can}
                    />
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
