import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, KpiChip, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Printer } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  AddPrinterButton,
  PrinterRowActions,
  ResolveAlertButton,
} from "@/components/printers/printer-actions";
import { requirePermission } from "@/lib/server/auth";
import { printerOverview } from "@/lib/server/printers";

export async function generateMetadata() {
  const t = await getTranslations("printers");
  return { title: t("title") };
}

/** Add printer: the only printers certificates and ID cards can come out of, their print program keys, alerts and recent jobs. */
export default async function PrintersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "certificates.printers");
  const t = await getTranslations("printers");
  const format = await getFormatter();
  const o = await printerOverview();
  const when = (s: string) =>
    format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });
  const active = o.printers.filter((p) => p.active).length;
  // The program checks in every few seconds; two minutes of silence means it is not running.
  const onlineSince = Date.now() - 2 * 60 * 1000;

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<AddPrinterButton />} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiChip label={t("kpiTotal")} value={format.number(o.printers.length)} />
        <KpiChip label={t("kpiActive")} value={format.number(active)} />
        <KpiChip label={t("kpiInactive")} value={format.number(o.printers.length - active)} />
        <KpiChip label={t("kpiPrinted")} value={format.number(o.documents_printed)} />
        <KpiChip label={t("kpiPending")} value={format.number(o.pending)} />
        <KpiChip label={t("kpiFailed")} value={format.number(o.failed)} />
      </div>

      {o.alerts.length > 0 && (
        <Card className="mb-5 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">{t("alertsTitle")}</CardTitle>
          </CardHeader>
          <ul className="divide-y text-sm">
            {o.alerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
              >
                <div>
                  <p className="font-medium">
                    {a.printer_code && <Mono className="me-2">{a.printer_code}</Mono>}
                    {t(`alerts.${a.kind}`, {
                      ip: a.detail.ip ?? "—",
                      from: a.detail.from ?? "—",
                      to: a.detail.to ?? "—",
                      expected: a.detail.expected ?? "—",
                      seen: a.detail.seen ?? "—",
                      name: a.detail.name ?? "—",
                    })}
                  </p>
                  <p className="text-muted-foreground text-xs">{when(a.at)}</p>
                </div>
                <ResolveAlertButton id={a.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        {o.printers.length === 0 ? (
          <EmptyState
            icon={<Printer />}
            title={t("noPrinters")}
            description={t("noPrintersBody")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("printerId")}</TableHead>
                <TableHead>{t("printer")}</TableHead>
                <TableHead>{t("serialNo")}</TableHead>
                <TableHead>{t("network")}</TableHead>
                <TableHead>{t("location")}</TableHead>
                <TableHead>{t("program")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-end">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.printers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Mono>{p.code}</Mono>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="block font-medium">{p.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {p.manufacturer} {p.model} · {t(`connection.${p.connection_type}`)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Mono>{p.serial_no}</Mono>
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.ip_address || p.mac_address ? (
                      <>
                        <Mono className="block">{p.ip_address ?? "—"}</Mono>
                        <Mono className="block">{p.mac_address ?? "—"}</Mono>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.location}
                    {p.department && (
                      <span className="text-muted-foreground block text-xs">{p.department}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {!p.has_key ? (
                      <span className="text-status-pending">{t("programNoKey")}</span>
                    ) : p.agent_last_seen && new Date(p.agent_last_seen).getTime() > onlineSince ? (
                      <span className="text-status-approved">{t("programOnline")}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {p.agent_last_seen
                          ? t("programLastSeen", { time: when(p.agent_last_seen) })
                          : t("programNever")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.active ? t("active") : t("inactive")}
                  </TableCell>
                  <TableCell>
                    <PrinterRowActions printer={p} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {o.jobs.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">{t("jobsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("document")}</TableHead>
                  <TableHead>{t("printer")}</TableHead>
                  <TableHead>{t("sent")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>
                      <Mono>{j.serial}</Mono>
                    </TableCell>
                    <TableCell className="text-sm">{j.printer_name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {when(j.requested_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t(`job.${j.status}`)}
                      {j.error && (
                        <span className="text-status-rejected block text-xs">{j.error}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
