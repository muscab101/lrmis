import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Alert, Mono, PageHeader } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Home, MapPinned } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { DecideDemolition, RestoreDemolition } from "@/components/demolitions/demolition-actions";
import { GeometryPreview } from "@/components/map/geometry-preview";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getDemolition } from "@/lib/server/demolitions";
import { fullHouseNo } from "@/lib/house-no";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDemolition(id);
  return { title: d?.row.snapshot.pun ?? d?.row.number ?? "404" };
}

export default async function DemolitionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission(locale, "parcels.demolitions");
  const found = await getDemolition(id);
  if (!found) notFound();
  const { row: d, history: h } = found;
  const s = d.snapshot;
  const t = await getTranslations("demolitions");
  const ts = await getTranslations("stage");
  const format = await getFormatter();
  const lang = await getLocale();
  const name = (o: { name_so: string; name_en: string } | null | undefined) =>
    o ? (lang === "so" ? o.name_so : o.name_en) : "—";
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const day = (v: string | null | undefined) =>
    v
      ? format.dateTime(new Date(v.length === 10 ? `${v}T00:00:00` : v), { dateStyle: "medium" })
      : "—";
  const when = (v: string) =>
    format.dateTime(new Date(v), { dateStyle: "medium", timeStyle: "short" });
  const m2 = (n: number | null) =>
    n != null ? `${format.number(Number(n), { maximumFractionDigits: 2 })} m²` : "—";
  const canApprove = viewer.can("parcels.demolish_approve");
  const open = d.status === "approved" && !d.rebuilt_at;
  const owed = h.invoices
    .filter((i) => ["issued", "partially_paid"].includes(i.status))
    .reduce((sum, i) => sum + Number(i.balance), 0);

  const place: [string, React.ReactNode][] = [
    [t("place_d"), name(s.district)],
    [t("place_s"), s.section ? `${s.section.code} · ${name(s.section)}` : "—"],
    [t("place_k"), s.sector ? `${s.sector.code} · ${name(s.sector)}` : "—"],
    [t("place_n"), s.neighbourhood?.code ?? "—"],
    [t("colHouse"), fullHouseNo(s.neighbourhood?.code, s.house_no) ?? "—"],
    [t("account"), <Mono key="a">{s.account_no ?? "—"}</Mono>],
    [t("area"), m2(s.area_m2)],
    [t("grade"), (lang === "so" ? s.grade_so : s.grade_en) ?? "—"],
    [t("landUse"), ts.has(`landUses.${s.land_use}`) ? ts(`landUses.${s.land_use}`) : s.land_use],
    ...(s.layout !== "house"
      ? [[t("kind"), t(`layout_${s.layout}`)] as [string, React.ReactNode]]
      : []),
    [t("registeredOn"), day(s.registered_at)],
  ];
  const info: [string, React.ReactNode][] = [
    [t("date"), day(d.demolition_date)],
    [t("reason"), d.reason],
    ...(d.notes ? [[t("notes"), d.notes] as [string, React.ReactNode]] : []),
    [t("demolishedBy"), d.demolished_by ?? "—"],
    [t("requestedBy"), `${h.names.requested_by ?? "—"} · ${day(d.requested_at)}`],
    [t("decidedBy"), d.decided_at ? `${h.names.decided_by ?? "—"} · ${day(d.decided_at)}` : "—"],
    ...(d.decision_note ? [[t("decisionNote"), d.decision_note] as [string, React.ReactNode]] : []),
    [t("archivedOn"), day(d.archived_at)],
    ...(d.restored_at
      ? [
          [
            t("restoredOn"),
            `${h.names.restored_by ?? "—"} · ${day(d.restored_at)} · ${d.restore_reason ?? ""}`,
          ] as [string, React.ReactNode],
        ]
      : []),
  ];
  const dl = (rows: [string, React.ReactNode][]) => (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={d.number}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{s.pun ?? "—"}</Mono>
            <StatusBadge
              tone={
                d.status === "approved" ? "rejected" : d.status === "pending" ? "pending" : "draft"
              }
            >
              {t(`status_${d.status}`)}
            </StatusBadge>
            {d.rebuilt_at && <StatusBadge tone="approved">{t("rebuilt")}</StatusBadge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canApprove && d.status === "pending" && <DecideDemolition ids={[d.id]} />}
            {canApprove && open && (
              <Button asChild size="sm">
                <Link href={`/demolished/${d.id}/register`}>
                  <Home aria-hidden />
                  {t("registerNow")}
                </Link>
              </Button>
            )}
            {canApprove && open && <RestoreDemolition id={d.id} />}
            <Button asChild variant="outline" size="sm">
              <Link href={`/parcels/${d.parcel_id}`}>{t("openLand")}</Link>
            </Button>
          </div>
        }
      />
      {d.rebuilt_at && (
        <Alert
          tone="success"
          className="mb-5"
          title={t("rebuiltTitle", { building: d.building_no ?? "" })}
        >
          {[
            t("rebuiltOn", { date: day(d.rebuilt_at), by: h.names.rebuilt_by ?? "—" }),
            d.new_house_no && t("nowHouse", { no: fullHouseNo(s.neighbourhood?.code, d.new_house_no)! }),
            d.new_owner_names && `${t("owner")}: ${d.new_owner_names}`,
            d.rebuild_note,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Alert>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("originalPlace")}</CardTitle>
          </CardHeader>
          <CardContent>{dl(place)}</CardContent>
        </Card>
        <div className="space-y-2">
          <GeometryPreview geometry={s.geom} className="h-72 md:h-[calc(100%-1.75rem)]" />
          <Link
            href={`/map`}
            className="text-muted-foreground hover:text-primary flex items-center gap-1.5 text-xs"
          >
            <MapPinned className="size-3.5" aria-hidden />
            {t("originalBoundary")}
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("demolitionInfo")}</CardTitle>
          </CardHeader>
          <CardContent>{dl(info)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ownersThen")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {s.owners.length > 0 && (
              <ul className="divide-y">
                {s.owners.map((o) => (
                  <li key={o.party_id} className="flex justify-between gap-2 py-2">
                    <Link href={`/owners/${o.party_id}`} className="hover:text-primary">
                      {o.full_name}
                    </Link>
                    <span className="text-muted-foreground text-xs">{o.phone ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.units.length > 0 && (
              <ul className="divide-y">
                {s.units.map((u) => (
                  <li key={u.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      <Link href={`/parcels/${u.id}`} className="hover:text-primary">
                        <Mono>{u.pun}</Mono>
                      </Link>
                      <span className="text-muted-foreground ms-2 text-xs">{m2(u.area_m2)}</span>
                    </span>
                    <span>{u.owners.map((o) => o.full_name).join(", ") || "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.shared_spaces.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {t("sharedSpaces")}:{" "}
                {s.shared_spaces.map((x) => `${x.name} ${m2(x.area_m2)}`).join(" · ")}
              </p>
            )}
            {h.owner_history.some((o) => o.valid_to) && (
              <div className="border-t pt-3">
                <p className="mb-1 font-medium">{t("ownerHistory")}</p>
                <ul className="space-y-1">
                  {h.owner_history.map((o, i) => (
                    <li
                      key={i}
                      className="text-muted-foreground flex justify-between gap-2 text-xs"
                    >
                      <span>{o.full_name}</span>
                      <span>
                        {day(o.valid_from)} – {o.valid_to ? day(o.valid_to) : t("now")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="overflow-hidden md:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              {t("taxHistory")}
              <span
                className={`text-sm font-medium ${owed > 0 ? "text-danger" : "text-muted-foreground"}`}
              >
                {t("owedNow", { amount: usd(owed) })}
              </span>
            </CardTitle>
          </CardHeader>
          {h.invoices.length === 0 ? (
            <CardContent className="text-muted-foreground text-sm">{t("noBills")}</CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colBill")}</TableHead>
                  <TableHead>{t("colPun")}</TableHead>
                  <TableHead>{t("colFee")}</TableHead>
                  <TableHead>{t("colIssued")}</TableHead>
                  <TableHead className="text-end">{t("colTotal")}</TableHead>
                  <TableHead className="text-end">{t("colPaid")}</TableHead>
                  <TableHead className="text-end">{t("colOwed")}</TableHead>
                  <TableHead>{t("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link href={`/invoices/${i.id}`} className="hover:text-primary">
                        <Mono>{i.number}</Mono>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-xs">{i.pun}</Mono>
                    </TableCell>
                    <TableCell className="text-sm">
                      {(lang === "so" ? i.fee_so : i.fee_en) ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{day(i.issue_date)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(i.total)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(i.paid)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(i.balance)}
                    </TableCell>
                    <TableCell className="text-sm">{i.status.replace(/_/g, " ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        {h.others.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("otherDemolitions")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {h.others.map((o) => (
                  <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/demolished/${o.id}`} className="hover:text-primary">
                      <Mono>{o.number}</Mono>
                    </Link>
                    <span className="text-muted-foreground">
                      {day(o.demolition_date)} · {t("colHouse")} {fullHouseNo(s.neighbourhood?.code, o.house_no) ?? "—"}
                      {o.building_no && ` · ${o.building_no}`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("auditHistory")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {h.audit.map((a, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{t.has(`audit_${a.action}`) ? t(`audit_${a.action}`) : a.action}</span>
                  <span className="text-muted-foreground text-xs">
                    {a.by ?? "—"} · {when(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
