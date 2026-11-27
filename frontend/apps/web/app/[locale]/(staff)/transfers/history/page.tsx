import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowRightLeft, Download, Eye, Paperclip } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Pager } from "@/components/admin/pager";
import { TransferStateBadge } from "@/components/legal/transfer-state";
import { TransferTabs } from "@/components/legal/transfer-tabs";
import { Link } from "@/i18n/navigation";
import { fullHouseNo } from "@/lib/house-no";
import { requirePermission } from "@/lib/server/auth";
import { TRANSFER_STATES, type TransferHistoryFilters, transferHistory, type TransferState } from "@/lib/server/transfer-history";
import { listDistricts } from "@/lib/server/users";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("legal.history");
  return { title: t("title") };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Every ownership transfer in the user's districts: counts, search and filters, and a link to each one. */
export default async function TransferHistoryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "transfers.view");
  const t = await getTranslations("legal.history");
  const tst = await getTranslations("legal.states");
  const tl = await getTranslations("legal");
  const format = await getFormatter();
  const sp = await searchParams;
  const filters: TransferHistoryFilters = {
    q: (sp.q ?? "").slice(0, 80) || undefined,
    district: UUID.test(sp.district ?? "") ? sp.district : undefined,
    neighbourhood: UUID.test(sp.neighbourhood ?? "") ? sp.neighbourhood : undefined,
    type: UUID.test(sp.type ?? "") ? sp.type : undefined,
    state: (TRANSFER_STATES as readonly string[]).includes(sp.state ?? "") || sp.state === "pending" ? (sp.state as TransferState | "pending") : undefined,
    from: DATE.test(sp.from ?? "") ? sp.from : undefined,
    to: DATE.test(sp.to ?? "") ? sp.to : undefined,
    page: Math.max(1, Number(sp.page) || 1),
    size: 25,
  };
  const supabase = await createClient();
  const [{ rows, total, stats }, districts, types, hoods] = await Promise.all([
    transferHistory(filters),
    listDistricts(),
    supabase.from("transfer_types").select("id, name_so, name_en").order("sort").order("name_en"),
    filters.district
      ? supabase.from("neighbourhoods").select("id, code, name_so, name_en").eq("district_id", filters.district).is("deleted_at", null).order("code")
      : Promise.resolve({ data: [] as { id: string; code: string; name_so: string; name_en: string }[] }),
  ]);
  const nm = (o: { name_so: string; name_en: string }) => (locale === "so" ? o.name_so : o.name_en);
  const keep = new URLSearchParams(
    Object.entries({ q: filters.q, district: filters.district, neighbourhood: filters.neighbourhood, type: filters.type, state: filters.state, from: filters.from, to: filters.to }).filter(
      (e): e is [string, string] => !!e[1],
    ),
  );
  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/transfers/history?${p.toString()}`;
  };
  const exportHref = (fmt: string) => {
    const p = new URLSearchParams(keep);
    p.set("format", fmt);
    return `/api/exports/transfers?${p.toString()}`;
  };
  const cards: [string, number, "default" | "success" | "warning" | "danger", string | null][] = [
    [t("total"), stats.total, "default", null],
    [t("pending"), stats.pending, "warning", "pending"],
    [t("approved"), stats.approved, "success", "approved"],
    [t("rejected"), stats.rejected, "danger", "rejected"],
    [t("thisMonth"), stats.this_month, "default", null],
  ];

  return (
    <>
      <PageHeader
        title={tl("transfersTitle")}
        description={t("subtitle")}
      >
        <TransferTabs active="history" />
        <div className="flex flex-wrap gap-8">
          {cards.map(([label, n, tone, state]) =>
            state ? (
              <Link key={label} href={`/transfers/history?state=${state}`} className="hover:opacity-80">
                <KpiChip label={label} value={format.number(n)} tone={tone} />
              </Link>
            ) : (
              <KpiChip key={label} label={label} value={format.number(n)} tone={tone} />
            ),
          )}
        </div>
      </PageHeader>

      <Card className="overflow-hidden">
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <Input name="q" defaultValue={filters.q} placeholder={t("search")} aria-label={t("search")} className="lg:col-span-2" />
          <NativeSelect name="district" defaultValue={filters.district ?? ""} aria-label={t("district")}>
            <option value="">{t("anyDistrict")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {nm(d)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="neighbourhood" defaultValue={filters.neighbourhood ?? ""} aria-label={t("neighbourhood")} disabled={!filters.district}>
            <option value="">{filters.district ? t("anyNeighbourhood") : t("pickDistrictFirst")}</option>
            {(hoods.data ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.code} · {nm(n)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="type" defaultValue={filters.type ?? ""} aria-label={t("type")}>
            <option value="">{t("anyType")}</option>
            {((types.data ?? []) as { id: string; name_so: string; name_en: string }[]).map((x) => (
              <option key={x.id} value={x.id}>
                {nm(x)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="state" defaultValue={filters.state ?? ""} aria-label={t("status")}>
            <option value="">{t("anyStatus")}</option>
            <option value="pending">{t("pending")}</option>
            {TRANSFER_STATES.map((s) => (
              <option key={s} value={s}>
                {tst(s)}
              </option>
            ))}
          </NativeSelect>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("from")}
            <Input type="date" name="from" defaultValue={filters.from} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("to")}
            <Input type="date" name="to" defaultValue={filters.to} className="flex-1" />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm">
              {t("filter")}
            </Button>
            {keep.toString() && (
              <Button size="sm" variant="ghost" asChild>
                <Link href="/transfers/history">{t("clear")}</Link>
              </Button>
            )}
            <span className="text-xs text-muted-foreground">{t("found", { n: total })}</span>
            <span className="ms-auto flex gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={exportHref("xlsx")}>
                  <Download aria-hidden />
                  Excel
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={exportHref("pdf")}>
                  <Download aria-hidden />
                  PDF
                </a>
              </Button>
            </span>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<ArrowRightLeft />} title={t("empty")} description={t("emptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("transferId")}</TableHead>
                  <TableHead>{t("parcel")}</TableHead>
                  <TableHead>{t("district")}</TableHead>
                  <TableHead>{t("neighbourhood")}</TableHead>
                  <TableHead>{t("previousOwner")}</TableHead>
                  <TableHead>{t("newOwner")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead className="text-center">{t("files")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/transfers/${r.id}`} className="hover:text-primary">
                        <Mono>{r.number}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.parcel_id ? (
                        <Link href={`/parcels/${r.parcel_id}`} className="hover:text-primary">
                          <Mono>{r.pun ?? "—"}</Mono>
                        </Link>
                      ) : (
                        "—"
                      )}
                      {r.house_no && <span className="block text-xs text-muted-foreground">{fullHouseNo(r.nb_code, r.house_no)}</span>}
                    </TableCell>
                    <TableCell className="text-sm">{(locale === "so" ? r.district_so : r.district_en) ?? "—"}</TableCell>
                    <TableCell className="text-sm">{(locale === "so" ? r.nb_so : r.nb_en) ?? "—"}</TableCell>
                    <TableCell className="max-w-44 truncate text-sm" title={r.from_names ?? ""}>
                      {r.from_names ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-sm" title={r.to_names ?? ""}>
                      {r.to_names ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{(locale === "so" ? r.type_so : r.type_en) ?? tl(`transferKinds.${r.kind}`)}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{format.dateTime(new Date(r.on_date), { dateStyle: "medium" })}</TableCell>
                    <TableCell className="text-center text-sm tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                        {r.files}
                      </span>
                    </TableCell>
                    <TableCell>
                      <TransferStateBadge state={r.state} label={tst(r.state)} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/transfers/${r.id}`}>
                          <Eye aria-hidden />
                          {t("view")}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Pager page={filters.page!} pages={Math.max(1, Math.ceil(total / 25))} href={(p) => href({ page: String(p) })} />
      </Card>
    </>
  );
}
