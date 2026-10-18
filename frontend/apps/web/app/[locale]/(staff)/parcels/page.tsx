import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Lock, MapPinned } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ParcelRowActions } from "@/components/parcels/parcel-row-actions";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { searchParcels } from "@/lib/server/parcels";

export async function generateMetadata() {
  const t = await getTranslations("parcels");
  return { title: t("title") };
}

export default async function ParcelsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.view");
  const t = await getTranslations("parcels");
  const format = await getFormatter();
  const q = ((await searchParams).q ?? "").slice(0, 80);
  const rows = await searchParcels(q);
  const can = { update: viewer.can("parcels.update"), lock: viewer.can("parcels.lock") };
  const showInvoices = viewer.can("invoices.view");
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-3 border-b p-3" role="search">
          <Input name="q" defaultValue={q} placeholder={t("searchPlaceholderMore")} aria-label={t("searchPlaceholderMore")} className="max-w-md" />
          <span className="text-muted-foreground ms-auto text-xs">{t("count", { count: rows.length })}</span>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={<MapPinned />} title={q ? t("noMatches") : t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden xl:table-cell">{t("dateCreated")}</TableHead>
                <TableHead>{t("pun")}</TableHead>
                {showInvoices && <TableHead className="hidden md:table-cell">{t("invoice")}</TableHead>}
                <TableHead className="hidden xl:table-cell">{t("govtReceipt")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("houseNo")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("neighbourhood")}</TableHead>
                <TableHead>{t("ownerName")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="hidden text-sm whitespace-nowrap tabular-nums xl:table-cell">
                    {format.dateTime(new Date(p.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <Link href={`/parcels/${p.id}`} className="hover:text-primary inline-flex items-center gap-1.5">
                      {p.locked_at && <Lock className="text-danger size-3.5 shrink-0" aria-label={t("lockedLabel")} />}
                      <Mono>{p.pun ?? p.application_number ?? t("noPun")}</Mono>
                    </Link>
                    {/* Narrow screens: the hidden columns, in one line. */}
                    <div className="text-muted-foreground text-xs md:hidden">
                      {[p.neighbourhood, p.house_no && `${t("houseNoShort")} ${p.house_no}`].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  {showInvoices && (
                    <TableCell className="hidden text-sm md:table-cell">
                      {p.invoice ? (
                        <>
                          <Mono className="text-xs">{p.invoice}</Mono>
                          <div className={`text-xs tabular-nums ${Number(p.balance) > 0 ? "text-status-rejected" : "text-muted-foreground"}`}>
                            {Number(p.balance) > 0 ? t("owing", { amount: usd(p.balance) }) : t("paidUp")}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-sm xl:table-cell">{p.govt_receipt_no ? <Mono className="text-xs">{p.govt_receipt_no}</Mono> : "—"}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{p.house_no ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {p.neighbourhood ?? "—"}
                    <div className="text-muted-foreground text-xs">{p.district}</div>
                  </TableCell>
                  <TableCell className="text-sm">{p.owners ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ParcelStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell>
                    <ParcelRowActions parcel={p} can={can} />
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
