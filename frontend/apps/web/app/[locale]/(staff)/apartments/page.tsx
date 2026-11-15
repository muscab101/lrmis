import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Building2, Info } from "lucide-react";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { AutoSubmitForm } from "@/components/forms/auto-submit-form";
import { tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { listApartments } from "@/lib/server/apartments";

export async function generateMetadata() {
  const t = await getTranslations("apartments");
  return { title: t("title") };
}

const KINDS = ["flats", "compound"] as const;

/** Apartments: every flats building (or compound), how many flats it has, how many are registered, and what it owes. */
export default async function ApartmentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "parcels.view");
  const t = await getTranslations("apartments");
  const format = await getFormatter();
  const lang = await getLocale();
  const sp = await searchParams;
  const kind = (KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as (typeof KINDS)[number]) : "flats";
  const q = (sp.q ?? "").slice(0, 40);
  const owing = sp.owing === "1";
  const rows = await listApartments({ layout: kind, q, owing });
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const name = (x: { name_so: string; name_en: string } | null) => (x ? (lang === "so" ? x.name_so : x.name_en) : "");
  const href = (k: string, o: boolean) => `/apartments?${new URLSearchParams({ kind: k, ...(o ? { owing: "1" } : {}), ...(q ? { q } : {}) })}`;

  return (
    <>
      {/* Apartment buildings / Compounds: under the title, as plain tabs. */}
      <PageHeader title={t("title")} description={t("subtitle")}>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("title")}>
          {KINDS.map((k) => (
            <Link key={k} href={href(k, owing)} aria-current={kind === k ? "page" : undefined} className={tabClass(kind === k)}>
              {t(`kinds.${k}`)}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <Card className="overflow-hidden">
        {/* Search and "All / Still owing" (a dropdown): both apply at once. */}
        <AutoSubmitForm className="flex flex-wrap items-center gap-3 border-b p-3">
          <input type="hidden" name="kind" value={kind} />
          <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="max-w-md" />
          <NativeSelect name="owing" defaultValue={owing ? "1" : ""} aria-label={t("owingLabel")} className="w-auto min-w-40">
            <option value="">{t("all")}</option>
            <option value="1">{t("owing")}</option>
          </NativeSelect>
          <span className="text-muted-foreground ms-auto text-xs">{t("count", { count: rows.length })}</span>
        </AutoSubmitForm>
        {rows.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("building")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("place")}</TableHead>
                <TableHead className="text-end">{kind === "flats" ? t("flats") : t("houses")}</TableHead>
                <TableHead className="text-end">{t("registered")}</TableHead>
                <TableHead className="text-end">{t("partial")}</TableHead>
                <TableHead className="text-end">{t("owed")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("manager")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/apartments/${b.id}`} className="hover:text-primary font-medium">
                      <Mono>{b.pun ?? b.house_no ?? "—"}</Mono>
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {[b.building_no && t("buildingNo", { no: b.building_no }), kind === "flats" && b.floors ? t("floorCount", { count: b.floors }) : null].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {name(b.neighbourhood)}
                    <div className="text-muted-foreground text-xs">{name(b.district)}</div>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{b.units}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{b.registered}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{b.partial}</TableCell>
                  <TableCell className={`text-end text-sm tabular-nums ${b.owed > 0 ? "" : "text-muted-foreground"}`}>{b.owed > 0 ? usd(b.owed) : t("paid")}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {b.manager_name ?? "—"}
                    {b.manager_phone && <div className="text-muted-foreground text-xs">{b.manager_phone}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button asChild variant="ghost" size="icon-sm" className="text-status-partial">
                        <Link href={`/apartments/${b.id}`} aria-label={t("viewFlats")} title={t("viewFlats")}>
                          <Building2 aria-hidden />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link href={`/parcels/${b.id}`} aria-label={t("openLand")} title={t("openLand")}>
                          <Info aria-hidden />
                        </Link>
                      </Button>
                    </div>
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
