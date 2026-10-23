import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { EmptyState, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowRightLeft, Banknote, Eye, MapPinned } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { legalCounts, listTransfers, type RequestStatus } from "@/lib/server/legal";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: t("transfersTitle") };
}

const FILTERS = ["submitted", "draft", "approved", "rejected", "cancelled", "any"] as const;

export default async function TransfersPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "transfers.view");
  const canCollect = viewer.can("cashier.view");
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as RequestStatus | "any") : "submitted";
  const [rows, counts] = await Promise.all([listTransfers(filter), legalCounts()]);
  const badge: Partial<Record<string, number>> = { submitted: counts.transfers_waiting, draft: counts.transfers_draft };
  const names = (o: { full_name: string }[]) => o.map((x) => x.full_name).join(", ") || "—";

  return (
    <>
      <PageHeader title={t("transfersTitle")} description={t("transfersSubtitle")} />
      <Card className="overflow-hidden">
        <nav className="flex flex-wrap gap-1.5 border-b p-3 text-sm">
          {FILTERS.map((f) => (
            <Link key={f} href={`/transfers?f=${f}`} className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {f === "any" ? t("all") : t(`status.${f}`)}
              {badge[f] ? <span className="ms-1.5 font-mono text-[11px]">{badge[f]}</span> : null}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState icon={<ArrowRightLeft />} title={t("noTransfers")} description={t("noTransfersBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("number")}</TableHead>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead>{t("kind")}</TableHead>
                <TableHead>{t("from")}</TableHead>
                <TableHead>{t("to")}</TableHead>
                <TableHead>{t("duty")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/transfers/${r.id}`} className="hover:text-primary">
                      <Mono>{r.number}</Mono>
                    </Link>
                    <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(r.created_at), { dateStyle: "medium" })}</span>
                  </TableCell>
                  <TableCell>
                    <Mono>{r.parcel?.pun ?? "—"}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">{t(`transferKinds.${r.kind}`)}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{names(r.from_owners)}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{names(r.to_owners)}</TableCell>
                  <TableCell className="text-sm">
                    {r.duty_invoice ? (
                      <>
                        {format.number(Number(r.duty_invoice.total), { style: "currency", currency: "USD" })}
                        <span className={`block text-xs ${Number(r.duty_invoice.balance) > 0 ? "text-status-rejected" : "text-status-approved"}`}>
                          {Number(r.duty_invoice.balance) > 0 ? t("dutyUnpaid") : t("dutyPaid")}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{t(`status.${r.status}`)}</TableCell>
                  <TableCell>
                    {/* View the transfer (approve, reject and the rest are there), its parcel, and take the duty. */}
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon-sm" className="text-primary" asChild>
                        <Link href={`/transfers/${r.id}`} aria-label={t("viewTransfer")} title={t("viewTransfer")}>
                          <Eye aria-hidden />
                        </Link>
                      </Button>
                      {r.parcel && (
                        <Button variant="ghost" size="icon-sm" asChild>
                          <Link href={`/parcels/${r.parcel.id}`} aria-label={t("viewParcel")} title={t("viewParcel")}>
                            <MapPinned aria-hidden />
                          </Link>
                        </Button>
                      )}
                      {canCollect && r.duty_invoice && Number(r.duty_invoice.balance) > 0 && (
                        <Button variant="ghost" size="icon-sm" className="text-status-approved" asChild>
                          <Link href={`/cashier?find=${encodeURIComponent(r.duty_invoice.number)}`} aria-label={t("takeDuty")} title={t("takeDuty")}>
                            <Banknote aria-hidden />
                          </Link>
                        </Button>
                      )}
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
