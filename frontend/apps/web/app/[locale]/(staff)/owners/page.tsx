import { partiesQuerySchema } from "@dhulka/core/schemas";
import { StatusBadge } from "@dhulka/ui/badge";
import { Card } from "@dhulka/ui/card";
import { EmptyState, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { OwnerRowActions } from "@/components/owners/owner-row-actions";
import { Link } from "@/i18n/navigation";
import { APP_PAGE_SIZE, queryParties } from "@/lib/server/applications";
import { requirePermission } from "@/lib/server/auth";
import { listDistricts } from "@/lib/server/users";
import { OwnersFilters } from "./owners-filters";
import { OwnersTabs } from "@/components/shell/section-tabs";

export async function generateMetadata() {
  const t = await getTranslations("owners");
  return { title: t("title") };
}

/** Two tabs: partial registration and registered (an old "all" link opens partial registration). */

export default async function OwnersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "owners.view");
  const t = await getTranslations("owners");
  const format = await getFormatter();
  const lang = await getLocale();
  const parsed = partiesQuerySchema.parse(await searchParams);
  // Registered owners show only for roles allowed to see them (Admin → Roles: "See registered owners").
  const seesRegistered = viewer.can("owners.registered");
  const q = parsed.stage === "all" || (parsed.stage === "registered" && !seesRegistered) ? { ...parsed, stage: "draft" as const } : parsed;
  const [{ rows, total }, districts] = await Promise.all([queryParties(q), listDistricts()]);
  const pages = Math.max(1, Math.ceil(total / APP_PAGE_SIZE));
  const districtName = (id: string | null) => {
    const d = districts.find((x) => x.id === id);
    return d ? (lang === "so" ? d.name_so : d.name_en) : "—";
  };
  const can = {
    update: viewer.can("owners.update"),
    remove: viewer.can("owners.delete"),
    removeRegistered: viewer.can("owners.delete_registered"),
  };
  const stageHref = (stage: string, extra: Record<string, string> = {}) =>
    `/owners?${new URLSearchParams({ stage, ...(q.kind ? { kind: q.kind } : {}), ...extra })}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t(`stageBody_${q.stage}`)}
      >
        {/* Partial registration · Registered · Managers. */}
        <OwnersTabs viewer={viewer} active={q.stage === "registered" ? "registered" : "draft"} kind={q.kind} />
      </PageHeader>
      <Card className="overflow-hidden">
        <OwnersFilters q={q.q} kind={q.kind} stage={q.stage} total={total} />
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={q.stage === "draft" ? t("emptyDraftTitle") : t("emptyTitle")}
            description={q.stage === "draft" ? t("emptyDraftBody") : t("emptyBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden lg:table-cell">{t("dateCreated")}</TableHead>
                <TableHead>{t("fullName")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("phone")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("districtColumn")}</TableHead>
                {q.stage === "all" && <TableHead className="hidden sm:table-cell">{t("status")}</TableHead>}
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="hidden text-sm whitespace-nowrap tabular-nums lg:table-cell">
                    {format.dateTime(new Date(p.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <Link href={`/owners/${p.id}`} className="hover:text-primary font-medium">
                      {p.full_name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {[p.mother_name, p.kind === "organisation" ? t("kind_organisation") : null].filter(Boolean).join(" · ")}
                      <span className="sm:hidden">{p.phone ? ` ${p.phone}` : ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {p.phone ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {p.phone}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{districtName(p.district_id)}</TableCell>
                  {q.stage === "all" && (
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge tone={p.registered_at ? "approved" : "draft"}>{p.registered_at ? t("stateRegistered") : t("stateDraft")}</StatusBadge>
                    </TableCell>
                  )}
                  <TableCell>
                    <OwnerRowActions party={p} districts={districts} can={can} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!q.q && <Pager page={q.page} pages={pages} href={(n) => stageHref(q.stage, { page: String(n) })} />}
      </Card>
    </>
  );
}
