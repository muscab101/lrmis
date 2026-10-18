import { partiesQuerySchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { BadgeCheck, Plus, Users } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { Link } from "@/i18n/navigation";
import { APP_PAGE_SIZE, queryParties } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { OwnersFilters } from "./owners-filters";

export async function generateMetadata() {
  const t = await getTranslations("owners");
  return { title: t("title") };
}

export default async function OwnersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "owners.view");
  const t = await getTranslations("owners");
  const q = partiesQuerySchema.parse(await searchParams);
  const { rows, total } = await queryParties(q);
  const pages = Math.max(1, Math.ceil(total / APP_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          viewer.can("owners.create") && (
            <Button asChild>
              <Link href="/owners/new">
                <Plus aria-hidden />
                {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <OwnersFilters q={q.q} kind={q.kind} total={total} />
        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fullName")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("motherName")}</TableHead>
                <TableHead>{t("idNumber")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/owners/${p.id}`} className="font-medium hover:text-primary">
                      {p.full_name}
                    </Link>
                    {p.kind === "organisation" && <div className="text-xs text-muted-foreground">{t("kind_organisation")}</div>}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{p.mother_name ?? "—"}</TableCell>
                  <TableCell>{p.id_number ? <Mono className="text-xs">{p.id_number}</Mono> : "—"}</TableCell>
                  <TableCell>
                    {p.phone ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {p.phone}
                        {p.phone_verified_at && <BadgeCheck className="size-3.5 text-success" aria-label={t("verified")} />}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!q.q && <Pager page={q.page} pages={pages} href={(p) => `/owners?${new URLSearchParams({ kind: q.kind, page: String(p) })}`} />}
      </Card>
    </>
  );
}
