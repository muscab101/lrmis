import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { RunActions } from "@/components/billing/run-actions";
import { InvoiceStatusBadge, RunStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getRun, listInvoices } from "@/lib/server/billing";
import { listDistricts } from "@/lib/server/users";

export default async function RunPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "billing.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const run = await getRun(id);
  if (!run) notFound();
  const [districts, invoices] = await Promise.all([listDistricts(), run.status === "issued" ? listInvoices({ filter: "any", q: "", runId: run.id }) : null]);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const p = run.preview;
  const ex = p.exceptions ?? { already_invoiced: 0, no_assessment: 0, zero_amount: 0 };
  const dnames = run.district_ids.map((d) => districts.find((x) => x.id === d)).map((d) => (d ? (lang === "so" ? d.name_so : d.name_en) : "?"));
  const facts: [string, React.ReactNode][] = [
    [t("feeType"), run.fee_type ? (lang === "so" ? run.fee_type.name_so : run.fee_type.name_en) : "—"],
    [t("period"), run.period],
    [t("districts"), dnames.join(", ")],
    [t("dueDate"), format.dateTime(new Date(run.due_date), { dateStyle: "medium" })],
    [t("created"), format.dateTime(new Date(run.created_at), { dateStyle: "medium", timeStyle: "short" })],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={t("runsTitle")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{run.number}</Mono>
            <RunStatusBadge status={run.status} />
          </span>
        }
        description={run.note ?? undefined}
        actions={
          <RunActions
            id={run.id}
            status={run.status}
            isCreator={run.created_by === viewer.user.id}
            can={{ create: viewer.can("billing.create"), approve: viewer.can("billing.approve"), cancel: viewer.can("billing.cancel") }}
          />
        }
      />
      {run.status === "cancelled" && run.cancel_reason && (
        <Alert tone="warning" title={t("cancelledTitle")} className="mb-5">
          {run.cancel_reason}
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardContent className="pt-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{run.status === "issued" ? t("result") : t("previewTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="label-caps text-muted-foreground">{t("parcelsInScope")}</p>
                <p className="text-2xl font-semibold tabular-nums">{p.parcels ?? 0}</p>
              </div>
              <div>
                <p className="label-caps text-muted-foreground">{t("invoices")}</p>
                <p className="text-2xl font-semibold tabular-nums">{run.status === "issued" ? run.invoice_count : (p.count ?? 0)}</p>
              </div>
              <div>
                <p className="label-caps text-muted-foreground">{t("total")}</p>
                <p className="text-2xl font-semibold tabular-nums">{usd(run.status === "issued" ? run.total : (p.total ?? 0))}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {(["no_assessment", "already_invoiced", "zero_amount"] as const).map((k) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{t(`exceptions.${k}`)}</span>
                  <span className={`tabular-nums ${ex[k] > 0 ? "font-medium text-status-pending" : ""}`}>{ex[k]}</span>
                </li>
              ))}
            </ul>
            {p.at && <p className="mt-3 text-xs text-muted-foreground">{t("previewAt", { time: format.dateTime(new Date(p.at), { dateStyle: "medium", timeStyle: "short" }) })}</p>}
          </CardContent>
        </Card>
      </div>
      {invoices && (
        <Card className="mt-5 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoice")}</TableHead>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead className="text-end">{t("balance")}</TableHead>
                <TableHead>{t("statusLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                      <Mono>{i.number}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Mono>{i.parcel?.pun}</Mono>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(i.total)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{usd(i.balance)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={i.status} dueDate={i.due_date} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
