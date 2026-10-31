import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { PlaceFilter, type PlaceOption } from "@/components/billing/place-filter";
import { RunActions } from "@/components/billing/run-actions";
import { RunStatusBadge } from "@/components/billing/status";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getRun, runBatchBills, runBatches, runPlaceNames } from "@/lib/server/billing";
import { listDistricts } from "@/lib/server/users";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ batch?: string; d?: string; s?: string; k?: string; n?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const { batch } = sp;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "billing.view");
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const lang = await getLocale();
  const run = await getRun(id);
  if (!run) notFound();
  // A batch is one neighbourhood ("none": land without one).
  const batchId = batch === "none" ? null : batch && /^[0-9a-f-]{36}$/i.test(batch) ? batch : undefined;
  const [districts, places, allBatches, bills] = await Promise.all([
    listDistricts(),
    runPlaceNames(run, lang),
    run.status === "cancelled" ? [] : runBatches(run.id),
    batchId !== undefined && run.status !== "cancelled" ? runBatchBills(run.id, batchId) : null,
  ]);
  const nm = (so: string | null, en: string | null) => (lang === "so" ? so : en) ?? so ?? en ?? "—";
  // Filter the batches by place: district, then section, sector, neighbourhood (options come from the run's own land).
  const label = (code: string | null, so: string | null, en: string | null) =>
    [code, lang === "so" ? so : en].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ") || "—";
  const uniq = (items: { id: string | null; label: string }[]) =>
    [...new Map(items.filter((o): o is PlaceOption => !!o.id).map((o) => [o.id, o])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const inD = allBatches.filter((b) => !sp.d || b.district_id === sp.d);
  const inS = inD.filter((b) => !sp.s || b.section_id === sp.s);
  const inK = inS.filter((b) => !sp.k || b.sector_id === sp.k);
  const batches = inK.filter((b) => !sp.n || b.neighbourhood_id === sp.n);
  const filterLevels = [
    { key: "d" as const, options: uniq(allBatches.map((b) => ({ id: b.district_id, label: nm(b.district_so, b.district_en) }))) },
    ...(sp.d ? [{ key: "s" as const, options: uniq(inD.map((b) => ({ id: b.section_id, label: label(b.section_code, b.section_so, b.section_en) }))) }] : []),
    ...(sp.s ? [{ key: "k" as const, options: uniq(inS.map((b) => ({ id: b.sector_id, label: label(b.sector_code, b.sector_so, b.sector_en) }))) }] : []),
    ...(sp.k ? [{ key: "n" as const, options: uniq(inK.map((b) => ({ id: b.neighbourhood_id, label: label(b.neighbourhood_code, b.neighbourhood_so, b.neighbourhood_en) }))) }] : []),
  ];
  const filterQuery = { d: sp.d, s: sp.s, k: sp.k, n: sp.n };
  const keepFilter = new URLSearchParams(Object.entries(filterQuery).filter((e): e is [string, string] => !!e[1])).toString();
  const shown = batchId !== undefined ? allBatches.find((b) => b.neighbourhood_id === batchId) : undefined;
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const p = run.preview;
  const ex = p.exceptions ?? { already_invoiced: 0, no_assessment: 0, zero_amount: 0 };
  const dnames = run.district_ids.map((d) => districts.find((x) => x.id === d)).map((d) => (d ? (lang === "so" ? d.name_so : d.name_en) : "?"));
  const facts: [string, React.ReactNode][] = [
    [t("feeType"), run.fee_type ? (lang === "so" ? run.fee_type.name_so : run.fee_type.name_en) : "—"],
    [t("period"), run.period],
    [t("districts"), dnames.join(", ")],
    ...(places.length ? ([[t("placesLabel"), places.join(", ")]] as [string, React.ReactNode][]) : []),
    ...(run.automatic ? ([[t("madeBy"), t("automatic")]] as [string, React.ReactNode][]) : []),
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
      {allBatches.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader className="space-y-3">
            <div>
              <CardTitle className="text-base">{t("batchesTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("batchesBody")}</p>
            </div>
            <PlaceFilter levels={filterLevels} query={filterQuery} />
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("batchPlace")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("batchArea")}</TableHead>
                <TableHead className="text-end">{t("invoices")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead className="text-end">{t("batchSkipped")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {t("noBatchesHere")}
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b) => {
                const key = b.neighbourhood_id ?? "none";
                return (
                  <TableRow key={key} className={batch === key ? "bg-muted/50" : undefined}>
                    <TableCell>
                      <Link href={`/billing/runs/${run.id}?${keepFilter ? `${keepFilter}&` : ""}batch=${key}#bills`} className="text-primary hover:underline">
                        {b.neighbourhood_id ? [b.neighbourhood_code, nm(b.neighbourhood_so, b.neighbourhood_en)].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ") : t("noNeighbourhood")}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {[nm(b.section_so, b.section_en), nm(b.district_so, b.district_en)].filter((x) => x !== "—").join(", ")}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{b.bills}</TableCell>
                    <TableCell className="text-end tabular-nums">{usd(b.total)}</TableCell>
                    <TableCell className={`text-end tabular-nums ${b.skipped ? "text-status-pending" : "text-muted-foreground"}`}>{b.skipped}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {bills && (
        <Card id="bills" className="mt-5 scroll-mt-20 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">
              {t("batchBillsTitle", { place: shown?.neighbourhood_id ? [shown.neighbourhood_code, nm(shown.neighbourhood_so, shown.neighbourhood_en)].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ") : t("noNeighbourhood") })}
            </CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("parcel")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("houseNo")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("owner")}</TableHead>
                <TableHead className="text-end">{t("total")}</TableHead>
                <TableHead>{run.status === "issued" ? t("invoice") : t("batchState")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((r) => (
                <TableRow key={r.parcel_id}>
                  <TableCell>
                    <Link href={`/parcels/${r.parcel_id}`} className="hover:text-primary">
                      <Mono>{r.pun ?? "—"}</Mono>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{r.house_no ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.owner ?? "—"}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{r.amount != null && !r.exception ? usd(r.amount) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.invoice_id ? (
                      <Link href={`/invoices/${r.invoice_id}`} className="hover:text-primary">
                        <Mono>{r.invoice_number}</Mono>
                      </Link>
                    ) : r.exception ? (
                      <span className="text-status-pending">{t(`exceptions.${r.exception}`)}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("willBeBilled")}</span>
                    )}
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
