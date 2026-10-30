"use client";

import { Button } from "@dhulka/ui/button";
import { Tooltip } from "@dhulka/ui/form-controls";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { Eye, Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  closeDisputeAction,
  decideChangeAction,
  decidePermitAction,
  liftCourtOrderAction,
  releaseLienAction,
} from "@/app/[locale]/(staff)/transfers/actions";
import { Link } from "@/i18n/navigation";
import type { ParcelLegal, PermitRow } from "@/lib/server/legal";
import { DecideButtons } from "./decide";
import { NoteAction } from "./note-action";

type P = { parcel: { id: string; pun: string | null } | null };
const ParcelLink = ({ p }: { p: P["parcel"] }) =>
  p ? (
    <Link href={`/parcels/${p.id}`} className="hover:text-primary">
      <Mono>{p.pun ?? "—"}</Mono>
    </Link>
  ) : (
    <>—</>
  );

/** Every row: open the parcel (its legal tab shows the full record). */
function ViewParcel({ p }: { p: P["parcel"] }) {
  const t = useTranslations("legal");
  if (!p) return null;
  return (
    <Tooltip content={t("viewParcel")}>
      <Button asChild variant="ghost" size="icon-sm" className="text-primary">
        <Link href={`/parcels/${p.id}`} aria-label={t("viewParcel")}>
          <Eye aria-hidden />
        </Link>
      </Button>
    </Tooltip>
  );
}

function Empty() {
  const t = useTranslations("legal");
  return <EmptyState icon={<Inbox />} title={t("queueEmpty")} description={t("queueEmptyBody")} />;
}

export function DisputeTable({
  rows,
  me,
  canDecide,
}: {
  rows: (ParcelLegal["disputes"][number] & P)[];
  me: string;
  canDecide: boolean;
}) {
  const t = useTranslations("legal");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("parcel")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("claimant")}</TableHead>
          <TableHead>{t("opened")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <Mono>{d.number}</Mono>
            </TableCell>
            <TableCell>
              <ParcelLink p={d.parcel} />
            </TableCell>
            <TableCell className="text-sm">
              {t(`disputeKinds.${d.kind}`)}
              <span className="text-muted-foreground block max-w-xs truncate text-xs">
                {d.description}
              </span>
            </TableCell>
            <TableCell className="text-sm">{d.claimant_name}</TableCell>
            <TableCell className="text-sm">
              {format.dateTime(new Date(d.opened_at), { dateStyle: "medium" })}
            </TableCell>
            <TableCell className="text-sm">{t(`disputeStatus.${d.status}`)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ViewParcel p={d.parcel} />
                {canDecide && (
                  <>
                    {d.status === "open" && d.opened_by !== me && (
                      <span className="inline-flex gap-1.5">
                        <NoteAction
                          label={t("dismiss")}
                          title={t("dismissTitle")}
                          noteLabel={t("resolution")}
                          success={t("saved")}
                          submit={(n) =>
                            closeDisputeAction({ id: d.id, status: "dismissed", note: n })
                          }
                        />
                        <NoteAction
                          label={t("resolve")}
                          title={t("resolveTitle")}
                          noteLabel={t("resolution")}
                          variant="default"
                          success={t("saved")}
                          submit={(n) =>
                            closeDisputeAction({ id: d.id, status: "resolved", note: n })
                          }
                        />
                      </span>
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function LienTable({
  rows,
  me,
  canDecide,
}: {
  rows: (ParcelLegal["liens"][number] & P)[];
  me: string;
  canDecide: boolean;
}) {
  const t = useTranslations("legal");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("parcel")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("holder")}</TableHead>
          <TableHead className="text-end">{t("amount")}</TableHead>
          <TableHead>{t("registered")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => (
          <TableRow key={l.id}>
            <TableCell>
              <ParcelLink p={l.parcel} />
            </TableCell>
            <TableCell className="text-sm">{t(`lienKinds.${l.kind}`)}</TableCell>
            <TableCell className="text-sm">
              {l.holder}
              {l.reference && (
                <span className="text-muted-foreground block text-xs">{l.reference}</span>
              )}
            </TableCell>
            <TableCell className="text-end text-sm tabular-nums">
              {l.amount != null
                ? format.number(Number(l.amount), { style: "currency", currency: "USD" })
                : "—"}
            </TableCell>
            <TableCell className="text-sm">
              {format.dateTime(new Date(l.registered_at), { dateStyle: "medium" })}
            </TableCell>
            <TableCell className="text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ViewParcel p={l.parcel} />
                {canDecide && (
                  <>
                    {l.registered_by !== me && (
                      <NoteAction
                        label={t("release")}
                        title={t("releaseTitle")}
                        noteLabel={t("reason")}
                        success={t("saved")}
                        submit={(n) => releaseLienAction({ id: l.id, note: n })}
                      />
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function OrderTable({
  rows,
  me,
  canDecide,
}: {
  rows: (ParcelLegal["orders"][number] & P)[];
  me: string;
  canDecide: boolean;
}) {
  const t = useTranslations("legal");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("orderNo")}</TableHead>
          <TableHead>{t("parcel")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("court")}</TableHead>
          <TableHead>{t("orderDate")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <Mono>{o.order_no}</Mono>
            </TableCell>
            <TableCell>
              <ParcelLink p={o.parcel} />
            </TableCell>
            <TableCell className="text-sm">
              {t(`orderKinds.${o.kind}`)}
              <span className="text-muted-foreground block max-w-xs truncate text-xs">
                {o.description}
              </span>
            </TableCell>
            <TableCell className="text-sm">{o.court}</TableCell>
            <TableCell className="text-sm">
              {format.dateTime(new Date(o.order_date), { dateStyle: "medium" })}
            </TableCell>
            <TableCell className="text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ViewParcel p={o.parcel} />
                {canDecide && (
                  <>
                    {o.created_by !== me && (
                      <NoteAction
                        label={t("lift")}
                        title={t("liftTitle")}
                        noteLabel={t("reason")}
                        success={t("saved")}
                        submit={(n) => liftCourtOrderAction({ id: o.id, note: n })}
                      />
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type Change = {
  id: string;
  number: string;
  kind: string;
  status: string;
  reason: string;
  payload: { land_use?: string; children?: unknown[] } & Record<string, unknown>;
  requested_by: string | null;
  requested_at: string;
  puns: string[];
  result_puns: string[];
};

export function ChangeTable({ rows, canDecide }: { rows: Change[]; canDecide: boolean }) {
  const t = useTranslations("legal");
  const ts = useTranslations("stage");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("parcels")}</TableHead>
          <TableHead>{t("reason")}</TableHead>
          <TableHead>{t("requested_at")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Mono>{c.number}</Mono>
            </TableCell>
            <TableCell className="text-sm">
              {t(`changeKinds.${c.kind}`)}
              <span className="text-muted-foreground block text-xs">
                {c.kind === "change_of_use" &&
                  c.payload.land_use &&
                  `→ ${ts(`landUses.${c.payload.land_use}`)}`}
                {c.kind === "subdivide" && t("childCount", { n: c.payload.children?.length ?? 0 })}
                {c.kind === "correction" &&
                  Object.entries(c.payload)
                    .map(([k, val]) =>
                      k === "geom"
                        ? t("correctionBoundary")
                        : `${t(`correctionField.${k}`)}: ${typeof val === "boolean" ? (val ? t("yes") : t("no")) : String(val)}`,
                    )
                    .join(" · ")}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {c.puns.join(", ")}
              {c.result_puns.length > 0 && (
                <span className="text-status-approved block">→ {c.result_puns.join(", ")}</span>
              )}
            </TableCell>
            <TableCell className="max-w-xs text-sm">{c.reason}</TableCell>
            <TableCell className="text-sm">
              {format.dateTime(new Date(c.requested_at), { dateStyle: "medium" })}
            </TableCell>
            <TableCell className="text-sm">{t(`status.${c.status}`)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                {canDecide && (
                  <>
                    {c.status === "submitted" && (
                      <DecideButtons
                        decide={(v) =>
                          decideChangeAction({ id: c.id, approve: v.approve, note: v.note })
                        }
                      />
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PermitTable({
  rows,
  me,
  canDecide,
}: {
  rows: PermitRow[];
  me: string;
  canDecide: boolean;
}) {
  const t = useTranslations("legal");
  const format = useFormatter();
  if (!rows.length) return <Empty />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("number")}</TableHead>
          <TableHead>{t("parcel")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead>{t("applicant")}</TableHead>
          <TableHead>{t("feeInvoice")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          <TableHead className="text-end">{t("actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Mono>{p.number}</Mono>
              <span className="text-muted-foreground block text-xs">
                {format.dateTime(new Date(p.requested_at), { dateStyle: "medium" })}
              </span>
            </TableCell>
            <TableCell>
              <ParcelLink p={p.parcel} />
            </TableCell>
            <TableCell className="text-sm">
              {t(`permitKinds.${p.kind}`)}
              <span className="text-muted-foreground block max-w-xs truncate text-xs">
                {[
                  p.floors != null && t("floorsN", { n: p.floors }),
                  p.area_m2 != null && `${p.area_m2} m²`,
                  p.description,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </TableCell>
            <TableCell className="text-sm">{p.applicant_name}</TableCell>
            <TableCell className="text-sm">
              {p.fee_invoice ? (
                <Link href={`/invoices/${p.fee_invoice.id}`} className="hover:text-primary">
                  <Mono>{p.fee_invoice.number}</Mono>{" "}
                  <span className="text-muted-foreground text-xs">{p.fee_invoice.status}</span>
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-sm">
              {t(`status.${p.status}`)}
              {p.valid_until && (
                <span className="text-muted-foreground block text-xs">
                  {t("until", {
                    date: format.dateTime(new Date(p.valid_until), { dateStyle: "medium" }),
                  })}
                </span>
              )}
              {p.conditions && (
                <span className="text-muted-foreground block max-w-xs text-xs">{p.conditions}</span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap text-end">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ViewParcel p={p.parcel} />
                {canDecide && (
                  <>
                    {p.status === "submitted" && p.requested_by !== me && (
                      <DecideButtons
                        withConditions
                        decide={(v) => decidePermitAction({ id: p.id, ...v })}
                      />
                    )}
                  </>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
