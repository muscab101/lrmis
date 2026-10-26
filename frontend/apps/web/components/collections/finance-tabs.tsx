import { StatusBadge, type StatusTone } from "@dhulka/ui/badge";
import { cn } from "@dhulka/ui/lib/cn";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { FileSpreadsheet, HandCoins } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { HandoverCancel, HandoverReceive } from "@/components/collections/handovers";
import {
  BatchActions,
  LineActions,
  StatementUploadButton,
} from "@/components/collections/statements";
import { Link } from "@/i18n/navigation";
import type { Viewer } from "@/lib/server/auth";
import {
  collectionsChannels,
  listHandovers,
  listStatementBatches,
  statementLines,
  type BatchStatus,
} from "@/lib/server/finance";
import { listProviders } from "@/lib/server/payments";

const BATCH_TONE: Record<string, StatusTone> = {
  open: "draft",
  submitted: "pending",
  approved: "approved",
  rejected: "rejected",
};
const LINE_TONE: Record<string, StatusTone> = {
  matched: "approved",
  amount_mismatch: "partial",
  missing_in_system: "rejected",
  missing_in_provider: "pending",
};
const HANDOVER_TONE: Record<string, StatusTone> = {
  pending: "pending",
  received: "approved",
  disputed: "rejected",
  cancelled: "draft",
};

async function tools() {
  const [t, format] = await Promise.all([getTranslations("collections"), getFormatter()]);
  const usd = (n: number | null) =>
    n === null ? "—" : format.number(Number(n), { style: "currency", currency: "USD" });
  const day = (d: string) =>
    format.dateTime(new Date(d.length === 10 ? `${d}T00:00:00` : d), { dateStyle: "medium" });
  const when = (d: string) =>
    format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short" });
  return { t, usd, day, when };
}

/** Per way of paying: what cashiers recorded, how far it is checked, and what the statements say. */
export async function ChannelsTab({ from, to }: { from: string; to: string }) {
  const { t, usd } = await tools();
  const rows = (await collectionsChannels(from, to)).filter(
    (r) => r.recorded_n > 0 || r.statement_total > 0,
  );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<FileSpreadsheet />}
        title={t("channelsTab.none")}
        description={t("channelsTab.noneBody")}
      />
    );
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const money = [
    "recorded",
    "verified",
    "reconciled",
    "pending",
    "disputed",
    "statement_total",
  ] as const;
  return (
    <>
      <p className="text-muted-foreground border-b px-4 py-2 text-sm">{t("channelsTab.help")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("channelsTab.channel")}</TableHead>
            {money.map((k) => (
              <TableHead key={k} className="whitespace-nowrap text-end">
                {t(`channelsTab.cols.${k}`)}
              </TableHead>
            ))}
            <TableHead className="whitespace-nowrap text-end">
              {t("channelsTab.cols.duplicates")}
            </TableHead>
            <TableHead className="whitespace-nowrap text-end">
              {t("channelsTab.cols.missing_in_system")}
            </TableHead>
            <TableHead className="whitespace-nowrap text-end">
              {t("channelsTab.cols.missing_in_provider")}
            </TableHead>
            <TableHead className="whitespace-nowrap text-end">
              {t("channelsTab.cols.mismatch")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.channel}>
              <TableCell className="whitespace-nowrap text-sm font-medium">
                {t(`channels.${r.channel}`)}
                <span className="text-muted-foreground block text-xs font-normal">
                  {t("channelsTab.payments", { count: r.recorded_n })}
                </span>
              </TableCell>
              {money.map((k) => (
                <TableCell
                  key={k}
                  className={cn(
                    "text-end text-sm tabular-nums",
                    k === "recorded" && "font-semibold",
                    k === "disputed" && r.disputed > 0 && "text-danger",
                    k === "pending" && r.pending > 0 && "text-warning",
                  )}
                >
                  {usd(r[k])}
                </TableCell>
              ))}
              <TableCell
                className={cn(
                  "text-end text-sm tabular-nums",
                  r.duplicates > 0 && "text-warning font-medium",
                )}
              >
                {r.duplicates > 0 ? (
                  <Link
                    href={`/collections?tab=duplicates&from=${from}&to=${to}`}
                    className="hover:underline"
                  >
                    {r.duplicates}
                  </Link>
                ) : (
                  0
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "text-end text-sm tabular-nums",
                  r.missing_in_system_n > 0 && "text-danger",
                )}
              >
                {r.missing_in_system_n > 0
                  ? `${r.missing_in_system_n} · ${usd(r.missing_in_system)}`
                  : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-end text-sm tabular-nums",
                  r.missing_in_provider_n > 0 && "text-warning",
                )}
              >
                {r.missing_in_provider_n > 0
                  ? `${r.missing_in_provider_n} · ${usd(r.missing_in_provider)}`
                  : "—"}
              </TableCell>
              <TableCell
                className={cn("text-end text-sm tabular-nums", r.mismatch_n > 0 && "text-danger")}
              >
                {r.mismatch_n > 0 ? `${r.mismatch_n} · ${usd(r.mismatch)}` : "—"}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">{t("channelsTab.total")}</TableCell>
            {money.map((k) => (
              <TableCell key={k} className="text-end text-sm font-semibold tabular-nums">
                {usd(sum(k))}
              </TableCell>
            ))}
            <TableCell className="text-end text-sm font-semibold tabular-nums">
              {sum("duplicates")}
            </TableCell>
            <TableCell className="text-end text-sm font-semibold tabular-nums">
              {usd(sum("missing_in_system"))}
            </TableCell>
            <TableCell className="text-end text-sm font-semibold tabular-nums">
              {usd(sum("missing_in_provider"))}
            </TableCell>
            <TableCell className="text-end text-sm font-semibold tabular-nums">
              {usd(sum("mismatch"))}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  );
}

const BATCH_STATUSES: BatchStatus[] = ["open", "submitted", "approved", "rejected"];

/** The reconciliation workspace: statements on the left, the chosen one's lines on the right. */
export async function StatementsTab({
  batchId,
  status,
  viewer,
}: {
  batchId?: string;
  status: BatchStatus | null;
  viewer: Viewer;
}) {
  const { t, usd, day, when } = await tools();
  const [batches, providers] = await Promise.all([listStatementBatches(status), listProviders()]);
  const uploadable = providers.filter(
    (p) => !["cash", "test", "stripe", "waafipay"].includes(p.code),
  );
  const current = batches.find((b) => b.id === batchId) ?? batches[0];
  const lines = current ? await statementLines(current.id) : [];
  // What needs attention first, clean matches last.
  const order = {
    missing_in_system: 0,
    amount_mismatch: 1,
    missing_in_provider: 2,
    matched: 3,
  } as const;
  lines.sort((a, b) => order[a.status] - order[b.status]);
  const openLines = lines.filter((l) => l.status !== "matched" && !l.resolution_note).length;
  const editable = current && (current.status === "open" || current.status === "rejected");
  const name = (id: string | null) => (id ? (current?.names[id] ?? "—") : "—");
  const stTotal = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const sysTotal = lines.reduce((s, l) => s + (l.system_amount ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 text-sm">
        {[null, ...BATCH_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/collections?tab=statements${s ? `&status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-3 py-1",
              status === s ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted",
            )}
          >
            {s ? t(`statements.status.${s}`) : t("status.all")}
          </Link>
        ))}
        {viewer.can("reconciliation.create") && (
          <span className="ms-auto">
            <StatementUploadButton providers={uploadable} />
          </span>
        )}
      </div>
      {batches.length === 0 || !current ? (
        <EmptyState
          icon={<FileSpreadsheet />}
          title={t("statements.none")}
          description={t("statements.noneBody")}
        />
      ) : (
        <div className="grid md:grid-cols-[17rem_minmax(0,1fr)]">
          <ul className="divide-y border-e">
            {batches.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/collections?tab=statements${status ? `&status=${status}` : ""}&batch=${b.id}`}
                  className={cn(
                    "block px-4 py-3 text-sm",
                    b.id === current.id ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span>
                      <Mono>{b.number}</Mono> ·{" "}
                      {providers.find((p) => p.code === b.provider)?.name ?? b.provider}
                    </span>
                    <StatusBadge tone={BATCH_TONE[b.status] ?? "draft"}>
                      {t(`statements.status.${b.status}`)}
                    </StatusBadge>
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {day(b.date_from)} – {day(b.date_to)}
                  </span>
                  <span className="mt-1 block text-xs">
                    {Object.entries(b.summary)
                      .map(([k, n]) => `${t(`statements.lineStatus.${k}`)}: ${n}`)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
              <div className="text-sm">
                <p className="font-semibold">
                  <Mono>{current.number}</Mono> ·{" "}
                  {providers.find((p) => p.code === current.provider)?.name ?? current.provider} ·{" "}
                  {day(current.date_from)} – {day(current.date_to)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("statements.uploadedBy", {
                    name: name(current.created_by),
                    when: when(current.created_at),
                  })}
                  {current.submitted_by &&
                    ` · ${t("statements.submittedBy", { name: name(current.submitted_by) })}`}
                  {current.decided_by &&
                    ` · ${t("statements.decidedBy", { name: name(current.decided_by) })}`}
                </p>
                {current.decision_note && (
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      current.status === "rejected" ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {current.decision_note}
                  </p>
                )}
                <p className="mt-2 text-xs">
                  {t("statements.totals", {
                    statement: usd(stTotal),
                    system: usd(sysTotal),
                    diff: usd(stTotal - sysTotal),
                  })}
                  {editable && openLines > 0 && (
                    <span className="text-warning ms-2">
                      {t("statements.stillOpen", { count: openLines })}
                    </span>
                  )}
                </p>
              </div>
              <BatchActions
                id={current.id}
                number={current.number}
                status={current.status}
                open={openLines}
                can={{
                  work: viewer.can("reconciliation.update"),
                  approve: viewer.can("reconciliation.approve"),
                  selfMade:
                    current.created_by === viewer.user.id ||
                    current.submitted_by === viewer.user.id,
                }}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("statements.reference")}</TableHead>
                  <TableHead>{t("statements.date")}</TableHead>
                  <TableHead className="text-end">{t("statements.statementAmount")}</TableHead>
                  <TableHead className="text-end">{t("statements.systemAmount")}</TableHead>
                  <TableHead>{t("statusLabel")}</TableHead>
                  <TableHead>{t("statements.explanation")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow
                    key={l.id}
                    className={l.status === "matched" ? "text-muted-foreground" : ""}
                  >
                    <TableCell className="text-xs">
                      <Mono>{l.provider_ref ?? "—"}</Mono>
                      {l.payment && (
                        <Link
                          href={`/payments/${l.payment_id}`}
                          className="text-primary block hover:underline"
                        >
                          {l.payment.receipt_no}
                          {l.payment.payer_name ? ` · ${l.payment.payer_name}` : ""}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {l.line_date ? day(l.line_date) : "—"}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums">{usd(l.amount)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {usd(l.system_amount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={LINE_TONE[l.status] ?? "draft"}>
                        {t(`statements.lineStatus.${l.status}`)}
                      </StatusBadge>
                      {l.matched_by_hand && (
                        <span className="text-muted-foreground block text-xs">
                          {t("statements.byHand")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64 text-xs">
                      {l.resolution_note ??
                        (l.status === "matched" ? (
                          ""
                        ) : (
                          <span className="text-warning">{t("statements.needsExplaining")}</span>
                        ))}
                    </TableCell>
                    <TableCell className="text-end">
                      {editable && viewer.can("reconciliation.update") && (
                        <LineActions
                          line={l.id}
                          status={l.status}
                          explained={!!l.resolution_note}
                          canMatch
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}

/** Cash handed from cashiers to receivers: confirm what you received, or take back one nobody confirmed. */
export async function HandoversTab({ viewer, status }: { viewer: Viewer; status: string | null }) {
  const { t, usd, when } = await tools();
  const { rows, names } = await listHandovers({ status });
  const me = viewer.user.id;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-3 text-sm">
        {[null, "pending", "received", "disputed", "cancelled"].map((s) => (
          <Link
            key={s ?? "all"}
            href={`/collections?tab=handovers${s ? `&status=${s}` : ""}`}
            className={cn(
              "rounded-full border px-3 py-1",
              status === s ? "bg-ink text-ink-foreground border-transparent" : "hover:bg-muted",
            )}
          >
            {s ? t(`handovers.status.${s}`) : t("status.all")}
          </Link>
        ))}
        <span className="text-muted-foreground ms-auto">{t("handovers.help")}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<HandCoins />}
          title={t("handovers.none")}
          description={t("handovers.noneBody")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("handovers.number")}</TableHead>
              <TableHead>{t("handovers.from")}</TableHead>
              <TableHead>{t("handovers.receiver")}</TableHead>
              <TableHead className="text-end">{t("handovers.counted")}</TableHead>
              <TableHead className="text-end">{t("handovers.amount")}</TableHead>
              <TableHead className="text-end">{t("handovers.receivedCol")}</TableHead>
              <TableHead>{t("statusLabel")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow
                key={h.id}
                className={h.status === "cancelled" ? "text-muted-foreground" : ""}
              >
                <TableCell className="text-sm">
                  <Mono>{h.number}</Mono>
                  <span className="text-muted-foreground block text-xs">
                    {t("handovers.shift", { number: h.shift?.number ?? "—" })} ·{" "}
                    {when(h.created_at)}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{names[h.from_user] ?? "—"}</TableCell>
                <TableCell className="text-sm">{names[h.to_user] ?? "—"}</TableCell>
                <TableCell className="text-end text-sm tabular-nums">
                  {usd(h.shift?.counted_cash ?? null)}
                </TableCell>
                <TableCell className="text-end text-sm font-medium tabular-nums">
                  {usd(h.amount)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-end text-sm tabular-nums",
                    (h.difference ?? 0) < 0 && "text-danger",
                    (h.difference ?? 0) > 0 && "text-warning",
                  )}
                >
                  {usd(h.received_amount)}
                  {h.difference ? <span className="block text-xs">{usd(h.difference)}</span> : null}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={HANDOVER_TONE[h.status] ?? "draft"}>
                    {t(`handovers.status.${h.status}`)}
                  </StatusBadge>
                  {(h.receive_note || h.note) && (
                    <span className="text-muted-foreground mt-1 block max-w-56 truncate text-xs">
                      {h.receive_note ?? h.note}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  {h.status === "pending" && h.to_user === me && (
                    <HandoverReceive id={h.id} number={h.number} amount={h.amount} />
                  )}
                  {h.status === "pending" && h.from_user === me && (
                    <HandoverCancel id={h.id} number={h.number} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
