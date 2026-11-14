import { StatusBadge } from "@dhulka/ui/badge";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { ArrowLeft, CopyCheck, Info } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { GoApprove } from "@/components/approvals/go-approve";
import { ROW_ICON } from "@/components/collections/row-icon";
import { AutoSubmitForm } from "@/components/forms/auto-submit-form";
import { Link } from "@/i18n/navigation";
import { CHANNEL_ORDER } from "@/lib/collection-channels";
import { fullHouseNo } from "@/lib/house-no";
import { type BillTypeTotal, collectionsByPos, collectionsPosChoices, type PosCollections, posCashierPayments } from "@/lib/server/collections";

const STATUS_TONE = { pending: "pending", verified: "approved", reconciled: "approved", disputed: "rejected" } as const;
const ID = /^[0-9a-f-]{36}$/i;

/**
 * Collections → Point of sale: choose a point of sale, see every cashier (and the district's online payments) with what
 * they took, approved and waiting; approve a cashier's waiting payments in one go. A cashier's info opens on the page
 * itself: their money by way of paying (Cash, EVC Plus, eDahab, ZAAD …), and for each way every owner who paid.
 */
export async function PointOfSaleTab({
  sp,
  from,
  to,
  me,
  canApprove,
  superAdmin,
}: {
  sp: Record<string, string | undefined>;
  from: string;
  to: string;
  me: string;
  canApprove: boolean;
  /** The Super Admin may approve money they took themselves; nobody else may. */
  superAdmin: boolean;
}) {
  const t = await getTranslations("collections");
  const format = await getFormatter();
  const locale = await getLocale();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const district = (p: { district_so: string | null; district_en: string | null }) => (locale === "so" ? p.district_so : p.district_en) ?? "";
  const ways = (ch: Record<string, number>) =>
    CHANNEL_ORDER.filter((c) => Number(ch[c] ?? 0) > 0)
      .map((c) => `${t(`channels.${c}`)} ${usd(Number(ch[c]))}`)
      .join(" · ");

  const typeName = (b: { code: string; name_so: string; name_en: string }) => (locale === "so" ? b.name_so : b.name_en);
  const choices = await collectionsPosChoices();
  const posId = choices.some((c) => c.id === sp.pos) ? sp.pos! : null;
  const places = await collectionsByPos(from, to, posId);
  const base = { tab: "pos", from, to, ...(posId ? { pos: posId } : {}) };
  const href = (extra: Record<string, string> = {}) => `/collections?${new URLSearchParams({ ...base, ...extra })}`;

  // A cashier's info: ?via=<point of sale the payments were taken at>&cashier=<id or "system">[&online=1][&way=zaad].
  type Row = PosCollections["cashiers"][number];
  const open: { place: PosCollections; row: Row } | null = (() => {
    if (!posId || !sp.via || !ID.test(sp.via) || !sp.cashier) return null;
    const cashier = sp.cashier === "system" ? null : ID.test(sp.cashier) ? sp.cashier : undefined;
    if (cashier === undefined) return null;
    const place = places[0];
    const row = place?.cashiers.find((c) => c.pos_id === sp.via && c.cashier_id === cashier && c.online === (sp.online === "1"));
    return place && row ? { place, row } : null;
  })();
  const rowLink = (place: PosCollections, c: Row) =>
    href({ pos: place.id, via: c.pos_id, cashier: c.cashier_id ?? "system", ...(c.online ? { online: "1" } : {}) });
  const rowName = (c: Row) => (c.online ? t("pos.onlineRow") : (c.cashier ?? t("online")));

  const approveIcon = (place: PosCollections, c: Row) =>
    c.waiting_count > 0 && c.cashier_id && canApprove && (c.cashier_id !== me || superAdmin) ? (
      <GoApprove tab="accounting" iconOnly />
    ) : c.waiting_count === 0 ? (
      <StatusBadge tone="approved">{t("pos.allApproved")}</StatusBadge>
    ) : null;

  const filters = (
    // Keyed by the choice, so the list shows the open point of sale after a link changes it.
    <AutoSubmitForm key={`${posId ?? "all"}-${from}-${to}`} className="flex flex-wrap items-end gap-3 p-3 text-sm">
      <input type="hidden" name="tab" value="pos" />
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">{t("pos.search")}</span>
        <NativeSelect name="pos" defaultValue={posId ?? ""} className="w-full sm:w-auto sm:min-w-64">
          <option value="">{t("pos.all")}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {[`${c.code} · ${c.name}`, district(c)].filter(Boolean).join(" — ")}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">{t("from")}</span>
        <Input type="date" name="from" defaultValue={from} className="w-40" />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">{t("to")}</span>
        <Input type="date" name="to" defaultValue={to} className="w-40" />
      </label>
    </AutoSubmitForm>
  );

  // ---- One cashier's info ---------------------------------------------------------------------------------------
  if (open) {
    const { place, row } = open;
    const payments = await posCashierPayments(row.pos_id, row.cashier_id, from, to, row.online ? place.district_id : null);
    const way = (CHANNEL_ORDER as readonly string[]).includes(sp.way ?? "") ? sp.way! : null;
    // Money by bill type for this cashier: each payment's share on each bill.
    const byType = new Map<string, BillTypeTotal & { count: number }>();
    for (const p of payments) {
      for (const b of p.bills.map((x) => ({ ...x, amount: Number(x.amount) }))) {
        const cur = byType.get(b.code) ?? { code: b.code, name_so: b.name_so, name_en: b.name_en, total: 0, count: 0 };
        cur.total += b.amount;
        cur.count += 1;
        byType.set(b.code, cur);
      }
    }
    const types = [...byType.values()].sort((a, b) => b.total - a.total);
    const type = sp.type && byType.has(sp.type) ? sp.type : null;
    const hasType = (p: (typeof payments)[number], code: string) => p.bills.some((b) => b.code === code);
    const shown = payments.filter((p) => (!way || p.channel === way) && (!type || hasType(p, type)));
    const here = { via: row.pos_id, cashier: row.cashier_id ?? "system", ...(row.online ? { online: "1" } : {}) };
    const withType: Record<string, string> = type ? { type } : {};
    const withWay: Record<string, string> = way ? { way } : {};
    return (
      <>
        {filters}
        <section className="space-y-5 border-t p-4">
          <Link href={href()} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm">
            <ArrowLeft className="size-4" aria-hidden />
            {t("pos.backToCashiers", { place: place.name })}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold">{rowName(row)}</p>
              <p className="text-muted-foreground text-xs">
                {[`${place.code} ${place.name}`, row.online && row.cashier ? t("pos.recordedBy", { name: row.cashier }) : null, t("pos.paymentsCount", { count: row.payments })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex items-start gap-6">
              <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">{t("pos.total")}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{usd(row.total)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{t("pos.approvedSum")}</dt>
                  <dd className="text-status-approved text-lg font-semibold tabular-nums">{usd(row.approved)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{t("pos.waitingSum")}</dt>
                  <dd className={`text-lg font-semibold tabular-nums ${row.waiting > 0 ? "text-status-pending" : ""}`}>{usd(row.waiting)}</dd>
                </div>
              </dl>
              <div className="pt-3">{approveIcon(place, row)}</div>
            </div>
          </div>

          {/* By way of paying: tap one to see every owner who paid that way; tap it again to see all. */}
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">{t("pos.byWayTap")}</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {CHANNEL_ORDER.map((c) => {
                const list = payments.filter((p) => p.channel === c);
                const sum = list.reduce((s, p) => s + p.amount, 0);
                const active = way === c;
                const body = (
                  <>
                    <p className="text-muted-foreground text-xs">{t(`channels.${c}`)}</p>
                    <p className="font-semibold tabular-nums">{usd(sum)}</p>
                    <p className="text-muted-foreground text-[11px]">{t("pos.paymentsCount", { count: list.length })}</p>
                  </>
                );
                return (
                  <li key={c}>
                    {list.length === 0 ? (
                      <div className="bg-muted/40 rounded-lg border px-3 py-2 opacity-60">{body}</div>
                    ) : (
                      <Link
                        href={href({ ...here, ...withType, ...(active ? {} : { way: c }) })}
                        aria-current={active ? "true" : undefined}
                        className={`bg-card hover:border-primary/50 block rounded-lg border px-3 py-2 transition-colors ${active ? "border-primary ring-primary/30 ring-2" : ""}`}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* By bill type: tap one to see only the payments for it; tap it again to see all. */}
          {types.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium">{t("pos.byTypeTap")}</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {types.map((b) => {
                  const active = type === b.code;
                  return (
                    <li key={b.code}>
                      <Link
                        href={href({ ...here, ...withWay, ...(active ? {} : { type: b.code }) })}
                        aria-current={active ? "true" : undefined}
                        className={`bg-card hover:border-primary/50 block rounded-lg border px-3 py-2 transition-colors ${active ? "border-primary ring-primary/30 ring-2" : ""}`}
                      >
                        <p className="text-muted-foreground truncate text-xs">{typeName(b)}</p>
                        <p className="font-semibold tabular-nums">{usd(b.total)}</p>
                        <p className="text-muted-foreground text-[11px]">{t("pos.paymentsCount", { count: b.count })}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Every payment of the chosen way and type (or all), with the owners of the land. */}
          <div>
            <p className="mb-2 text-sm font-medium">
              {way || type
                ? t("pos.wayPayments", { way: [way ? t(`channels.${way}`) : null, type ? typeName(byType.get(type)!) : null].filter(Boolean).join(" · "), count: shown.length })
                : t("pos.allPayments", { count: shown.length })}
            </p>
            {shown.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("pos.noPayments")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pos.owner")}</TableHead>
                    <TableHead>{t("pos.land")}</TableHead>
                    <TableHead>{t("pos.receipt")}</TableHead>
                    <TableHead>{t("pos.way")}</TableHead>
                    <TableHead>{t("pos.paidFor")}</TableHead>
                    <TableHead className="text-end">{t("pos.amount")}</TableHead>
                    <TableHead>{t("statusLabel")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => (
                    <TableRow key={p.payment_id}>
                      <TableCell className="text-sm">
                        <span className="font-medium">{p.owners ?? p.payer ?? "—"}</span>
                        {p.payer && p.payer !== p.owners && <span className="text-muted-foreground block text-xs">{t("pos.paidBy", { name: p.payer })}</span>}
                        {p.payer_phone && <span className="text-muted-foreground block text-xs">{p.payer_phone}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Mono>{p.pun ?? "—"}</Mono>
                        {p.house_no && <span className="text-muted-foreground block text-xs">{fullHouseNo(p.neighbourhood, p.house_no)}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Link href={`/payments/${p.payment_id}`} className="hover:text-primary">
                          <Mono>{p.receipt_no}</Mono>
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {format.dateTime(new Date(p.received_at), { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t(`channels.${p.channel}`)}
                        {p.reference && <span className="text-muted-foreground block font-mono text-xs">{p.reference}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.bills.length === 0 && "—"}
                        {p.bills.map((b) => (
                          <span key={`${b.number}-${b.code}`} className="block">
                            {typeName(b)} <span className="text-muted-foreground text-xs tabular-nums">{usd(Number(b.amount))}</span>
                          </span>
                        ))}
                      </TableCell>
                      <TableCell className="text-end text-sm font-medium tabular-nums">{usd(p.amount)}</TableCell>
                      <TableCell>
                        <StatusBadge tone={STATUS_TONE[p.verify_status]}>{t(`status.${p.verify_status}`)}</StatusBadge>
                        {p.verified_by && <span className="text-muted-foreground block text-xs">{t("pos.by", { name: p.verified_by })}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </>
    );
  }

  // ---- Every point of sale (or the chosen one) with its cashiers --------------------------------------------------
  return (
    <>
      {filters}
      {places.length === 0 ? (
        <EmptyState icon={<CopyCheck />} title={t("pos.none")} description={t("pos.noneBody")} />
      ) : (
        <div className="divide-y border-t">
          {places.map((p) => (
            <section key={p.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">
                    <Mono className="me-2">{p.code}</Mono>
                    {p.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {[district(p), t("pos.paymentsCount", { count: p.payments })].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">{t("pos.total")}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{usd(p.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t("pos.approvedSum")}</dt>
                    <dd className="text-status-approved text-lg font-semibold tabular-nums">{usd(p.approved)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t("pos.waitingSum")}</dt>
                    <dd className={`text-lg font-semibold tabular-nums ${p.waiting > 0 ? "text-status-pending" : ""}`}>{usd(p.waiting)}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium">{t("pos.byWay")}</p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {CHANNEL_ORDER.map((c) => {
                    const v = Number(p.channels[c] ?? 0);
                    return (
                      <li key={c} className={`rounded-lg border px-3 py-2 ${v > 0 ? "bg-card" : "bg-muted/40 opacity-60"}`}>
                        <p className="text-muted-foreground text-xs">{t(`channels.${c}`)}</p>
                        <p className="font-semibold tabular-nums">{usd(v)}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {p.cashiers.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("cashier")}</TableHead>
                      <TableHead className="text-end">{t("recon.payments")}</TableHead>
                      {p.bill_types.map((b) => (
                        <TableHead key={b.code} className="text-end">
                          {typeName(b)}
                        </TableHead>
                      ))}
                      <TableHead className="text-end">{t("pos.total")}</TableHead>
                      <TableHead className="text-end">{t("pos.approvedSum")}</TableHead>
                      <TableHead className="text-end">{t("pos.waitingSum")}</TableHead>
                      <TableHead className="w-32" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.cashiers.map((c) => (
                      <TableRow key={`${c.cashier_id ?? "system"}-${c.online}-${c.pos_id}`}>
                        <TableCell className="text-sm">
                          <Link href={rowLink(p, c)} className="hover:text-primary font-medium">
                            {rowName(c)}
                          </Link>
                          {c.online && c.cashier && <span className="text-muted-foreground block text-xs">{t("pos.recordedBy", { name: c.cashier })}</span>}
                          {ways(c.channels) && <span className="text-muted-foreground block text-xs">{ways(c.channels)}</span>}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums">{c.payments}</TableCell>
                        {p.bill_types.map((b) => {
                          const v = Number(c.bill_types[b.code] ?? 0);
                          return (
                            <TableCell key={b.code} className={`text-end text-sm tabular-nums ${v > 0 ? "" : "text-muted-foreground"}`}>
                              {v > 0 ? usd(v) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-end text-sm font-semibold tabular-nums">{usd(c.total)}</TableCell>
                        <TableCell className="text-status-approved text-end text-sm tabular-nums">{usd(c.approved)}</TableCell>
                        <TableCell className={`text-end text-sm tabular-nums ${c.waiting > 0 ? "text-status-pending font-medium" : ""}`}>{usd(c.waiting)}</TableCell>
                        <TableCell className="text-end">
                          <span className="inline-flex items-center justify-end gap-1">
                            <Link href={rowLink(p, c)} className={ROW_ICON} aria-label={t("pos.info")} title={t("pos.info")}>
                              <Info aria-hidden />
                            </Link>
                            {approveIcon(p, c)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
