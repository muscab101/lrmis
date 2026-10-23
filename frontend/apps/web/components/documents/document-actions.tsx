"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Alert, EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { BadgeCheck, Inbox, Printer, RefreshCw, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  type BulkIssueResult,
  cancelDocumentAction,
  decideReprintAction,
  issueBulkAction,
  issueCertificateAction,
  reprintDirectAction,
  requestReissueAction,
  requestReprintAction,
} from "@/app/[locale]/(staff)/documents/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { Link, useRouter } from "@/i18n/navigation";
import type { DocumentChange, DocumentRow, ReprintRow } from "@/lib/server/certificates";

export function IssueCertificateButton({ parcelId, pun, size = "sm" }: { parcelId: string; pun: string; size?: "sm" | "default" }) {
  const t = useTranslations("documents");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <BadgeCheck aria-hidden />
        {t("issue")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("issueTitle")}
        description={t("issueBody", { pun })}
        confirmLabel={t("issue")}
        submit={() => issueCertificateAction({ parcelId })}
        onDone={(d) => toast.success(t("issued", { cards: (d as { id_cards: number }).id_cards }))}
      />
    </>
  );
}

type DocDialog = "reprint" | "reissue" | "direct" | "cancel";

export function DocumentActions({
  id,
  status,
  can,
  changes = [],
  pendingReason = null,
}: {
  id: string;
  status: string;
  can: { reprint: boolean; cancel: boolean; direct?: boolean };
  /** What a correction would change (document vs today's register). */
  changes?: DocumentChange[];
  /** Reason of a pending request, reused by a one-step reprint. */
  pendingReason?: string | null;
}) {
  const t = useTranslations("documents");
  const router = useRouter();
  const [dialog, setDialog] = useState<null | DocDialog>(null);
  const [reason, setReason] = useState("");
  const pending = pendingReason !== null;
  const copy: Record<DocDialog, { title: string; body: string; confirm: string; success: string }> = {
    reprint: { title: t("requestReprint"), body: t("reprintBody"), confirm: t("submitRequest"), success: t("reprintRequested") },
    reissue: { title: t("reissueTitle"), body: t("reissueBody"), confirm: t("submitRequest"), success: t("reissueRequested") },
    direct: { title: t("directTitle"), body: pending ? t("directBodyPending") : t("directBody"), confirm: t("directConfirm"), success: t("directDone") },
    cancel: { title: t("cancelTitle"), body: t("cancelBody"), confirm: t("cancelDocument"), success: t("cancelled") },
  };
  const submit = (d: DocDialog) => {
    if (d === "cancel") return cancelDocumentAction({ id, reason });
    if (d === "reissue") return requestReissueAction({ id, reason });
    if (d === "direct") return reprintDirectAction({ id, reason });
    return requestReprintAction({ id, reason });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/documents/${id}/print`} target="_blank">
          <Printer aria-hidden />
          {t("openPrint")}
        </Link>
      </Button>
      {status === "valid" && can.reprint && !pending && (
        <>
          <Button size="sm" variant="outline" onClick={() => setDialog("reprint")}>
            {t("requestReprint")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("reissue")}>
            <RefreshCw aria-hidden />
            {t("reissue")}
          </Button>
        </>
      )}
      {status === "valid" && can.direct && (
        <Button size="sm" variant="outline" onClick={() => setDialog("direct")}>
          <Zap aria-hidden />
          {t("directReprint")}
        </Button>
      )}
      {status === "valid" && can.cancel && (
        <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
          {t("cancelDocument")}
        </Button>
      )}
      <FormDialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setReason("");
          }
        }}
        title={dialog ? copy[dialog].title : ""}
        description={dialog ? copy[dialog].body : ""}
        confirmLabel={dialog ? copy[dialog].confirm : ""}
        destructive={dialog === "cancel"}
        successMessage={dialog ? copy[dialog].success : undefined}
        submit={() => submit(dialog!)}
        onDone={(d) => {
          const next = (d as { document_id?: string } | null)?.document_id;
          if (dialog === "direct" && next) router.push(`/documents/${next}`);
        }}
      >
        {(fe) => (
          <>
            {dialog === "reissue" && <ChangeList changes={changes} />}
            <Field id="reason" label={t("reason")} error={fe("reason")} required={!(dialog === "direct" && pending)} hint={dialog === "direct" && pending ? t("directReasonHint") : undefined}>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}
      </FormDialog>
    </div>
  );
}

/** Before → after for each field a correction would change. */
export function ChangeList({ changes }: { changes: DocumentChange[] }) {
  const t = useTranslations("documents");
  if (changes.length === 0) return <Alert tone="info" title={t("noChanges")} className="mb-3" />;
  return (
    <div className="mb-3 rounded-md border text-sm">
      <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{t("changesTitle")}</p>
      <dl className="divide-y">
        {changes.map((c) => (
          <div key={c.field} className="grid grid-cols-[8rem_1fr] gap-2 px-3 py-2">
            <dt className="text-muted-foreground">{t(`fields.${c.field}`)}</dt>
            <dd>
              <span className="text-muted-foreground line-through">{c.before ?? "—"}</span>
              <span className="mx-1.5" aria-hidden>
                →
              </span>
              <span className="font-medium">{c.after ?? "—"}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ReprintQueue({
  rows,
  me,
  canDecide,
  isSuperAdmin = false,
  canCashier = false,
}: {
  rows: ReprintRow[];
  me: string;
  canDecide: boolean;
  isSuperAdmin?: boolean;
  canCashier?: boolean;
}) {
  const t = useTranslations("documents");
  const router = useRouter();
  const [target, setTarget] = useState<{ id: string; mode: "approve" | "reject" | "direct" } | null>(null);
  const [note, setNote] = useState("");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noReprints")} description={t("noReprintsBody")} />;
  const row = rows.find((r) => r.id === target?.id);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("document")}</TableHead>
            <TableHead>{t("requestKind")}</TableHead>
            <TableHead>PUN</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("fee")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {(canDecide || isSuperAdmin) && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const feeOpen = r.fee_invoice !== null && r.fee_invoice.status !== "paid" && r.fee_invoice.status !== "cancelled";
            const mine = r.requested_by === me;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/documents/${r.document?.id}`} className="hover:text-primary">
                    <Mono>{r.document?.serial}</Mono>
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{t(`requestKinds.${r.kind}`)}</TableCell>
                <TableCell>
                  <Mono>{r.document?.parcel?.pun}</Mono>
                </TableCell>
                <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
                <TableCell className="text-sm">
                  {r.fee_invoice ? (
                    <span className="inline-flex flex-wrap items-center gap-x-2">
                      <Link href={`/invoices/${r.fee_invoice.id}`} className="underline">
                        <Mono>{r.fee_invoice.number}</Mono> · {t(`feeStatus.${r.fee_invoice.status === "paid" ? "paid" : "unpaid"}`)}
                      </Link>
                      {feeOpen && r.status === "pending" && canCashier && (
                        <Link href={`/cashier?find=${encodeURIComponent(r.fee_invoice.number)}`} className="text-xs text-primary underline">
                          {t("takePayment")}
                        </Link>
                      )}
                    </span>
                  ) : r.kind === "correction" ? (
                    <span className="text-muted-foreground">{t("noFee")}</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {t(`decision.${r.status}`)}
                  {r.status === "pending" && mine && !isSuperAdmin && <span className="block text-xs text-muted-foreground">{t("waitingOther")}</span>}
                  {r.status === "pending" && feeOpen && !mine && canDecide && <span className="block text-xs text-status-pending">{t("waitingFee")}</span>}
                </TableCell>
                {(canDecide || isSuperAdmin) && (
                  <TableCell className="text-end whitespace-nowrap">
                    {r.status === "pending" && (
                      <span className="inline-flex gap-1.5">
                        {canDecide && !mine && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, mode: "reject" })}>
                              {t("reject")}
                            </Button>
                            <Button size="sm" disabled={feeOpen} onClick={() => setTarget({ id: r.id, mode: "approve" })}>
                              <Printer aria-hidden />
                              {t("approvePrint")}
                            </Button>
                          </>
                        )}
                        {isSuperAdmin && (
                          <Button size="sm" variant="outline" onClick={() => setTarget({ id: r.id, mode: "direct" })}>
                            <Zap aria-hidden />
                            {t("directReprint")}
                          </Button>
                        )}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setNote("");
          }
        }}
        title={target?.mode === "approve" ? t("approveReprint") : target?.mode === "direct" ? t("directTitle") : t("rejectReprint")}
        description={target?.mode === "approve" ? t("approveReprintBody") : target?.mode === "direct" ? t("directBodyPending") : ""}
        confirmLabel={target?.mode === "approve" ? t("approvePrint") : target?.mode === "direct" ? t("directConfirm") : t("reject")}
        destructive={target?.mode === "reject"}
        successMessage={t("decided")}
        submit={() =>
          target!.mode === "direct"
            ? reprintDirectAction({ id: row!.document!.id, reason: "" })
            : decideReprintAction({ id: target!.id, approve: target!.mode === "approve", note })
        }
        onDone={(d) => {
          const next = (d as { document_id?: string } | null)?.document_id;
          if (next) router.push(`/documents/${next}/print`);
        }}
      >
        {target?.mode === "direct"
          ? undefined
          : (fe) => (
              <Field id="note" label={target?.mode === "approve" ? t("noteOptional") : t("reason")} error={fe("note")} required={target?.mode === "reject"}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
      </FormDialog>
    </>
  );
}

/** A bulk failure ("CONFLICT: not_eligible:unpaid,no_owner") as readable text. */
function failureText(t: (key: string) => string, te: { has: (key: string) => boolean; (key: string): string }, error: string) {
  const detail = error.replace(/^[A-Z_]+:\s*/, "");
  if (detail.startsWith("not_eligible:")) return detail.slice(13).split(",").map((b) => t(`blockers.${b}`)).join(" · ");
  return te.has(`details.${detail}`) ? te(`details.${detail}`) : detail;
}

export interface IssueRow {
  id: string;
  pun: string;
  registered_at: string | null;
  blockers: string[];
}

/** "To issue": tick eligible parcels and issue their certificates (and owners' ID cards) together. */
export function IssueQueue({ rows, canIssue }: { rows: IssueRow[]; canIssue: boolean }) {
  const t = useTranslations("documents");
  const te = useTranslations("errors");
  const format = useFormatter();
  const eligible = rows.filter((r) => r.blockers.length === 0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BulkIssueResult | null>(null);
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));
  const all = eligible.length > 0 && eligible.every((r) => picked.has(r.id));
  return (
    <>
      {canIssue && eligible.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">{t("selected", { count: picked.size })}</span>
          <Button size="sm" className="ms-auto" disabled={picked.size === 0} onClick={() => setOpen(true)}>
            <BadgeCheck aria-hidden />
            {t("issueSelected", { count: picked.size })}
          </Button>
        </div>
      )}
      {result && result.failed.length > 0 && (
        <Alert tone="warning" title={t("bulkIssueFailed", { count: result.failed.length })} className="m-3">
          <ul className="mt-1 list-disc ps-5">
            {result.failed.map((f) => (
              <li key={f.parcel_id}>
                <Mono>{f.pun}</Mono> — {failureText(t, te, f.error)}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canIssue && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t("selectAll")}
                  checked={all}
                  disabled={eligible.length === 0}
                  onCheckedChange={(v) => setPicked(v === true ? new Set(eligible.map((r) => r.id)) : new Set())}
                />
              </TableHead>
            )}
            <TableHead>PUN</TableHead>
            <TableHead>{t("registered")}</TableHead>
            <TableHead>{t("eligibility")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              {canIssue && (
                <TableCell>
                  {p.blockers.length === 0 && <Checkbox aria-label={p.pun} checked={picked.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />}
                </TableCell>
              )}
              <TableCell>
                <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                  <Mono>{p.pun}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-sm">{p.registered_at ? format.dateTime(new Date(p.registered_at), { dateStyle: "medium" }) : "—"}</TableCell>
              <TableCell className="text-sm">
                {p.blockers.length === 0 ? <span className="text-status-approved">{t("eligible")}</span> : p.blockers.map((b) => t(`blockers.${b}`)).join(" · ")}
              </TableCell>
              <TableCell className="text-end">{p.blockers.length === 0 && canIssue && <IssueCertificateButton parcelId={p.id} pun={p.pun} />}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("issueSelectedTitle", { count: picked.size })}
        description={t("issueSelectedBody")}
        confirmLabel={t("issueSelected", { count: picked.size })}
        submit={() => issueBulkAction({ parcelIds: [...picked] })}
        onDone={(d) => {
          const r = d as BulkIssueResult;
          setResult(r);
          setPicked(new Set());
          if (r.issued > 0) toast.success(t("bulkIssued", { count: r.issued, cards: r.id_cards }));
        }}
      />
    </>
  );
}

/** "To print": tick documents and open them together for one print run. */
export function PrintQueue({ rows, canPrint, notes = {} }: { rows: DocumentRow[]; canPrint: boolean; notes?: Record<string, { text: string; warn: boolean }> }) {
  const t = useTranslations("documents");
  const format = useFormatter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  return (
    <>
      {canPrint && (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">{t("selected", { count: picked.size })}</span>
          {picked.size > 0 ? (
            <Button size="sm" className="ms-auto" asChild>
              <Link href={`/documents/batch-print?ids=${[...picked].join(",")}`} target="_blank">
                <Printer aria-hidden />
                {t("printSelected", { count: picked.size })}
              </Link>
            </Button>
          ) : (
            <Button size="sm" className="ms-auto" disabled>
              <Printer aria-hidden />
              {t("printSelected", { count: 0 })}
            </Button>
          )}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canPrint && (
              <TableHead className="w-10">
                <Checkbox aria-label={t("selectAll")} checked={all} onCheckedChange={(v) => setPicked(v === true ? new Set(rows.map((r) => r.id)) : new Set())} />
              </TableHead>
            )}
            <TableHead>{t("serial")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>PUN</TableHead>
            <TableHead>{t("holder")}</TableHead>
            <TableHead className="text-end">{t("issuedOn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              {canPrint && (
                <TableCell>
                  <Checkbox aria-label={d.serial} checked={picked.has(d.id)} onCheckedChange={(v) => toggle(d.id, v === true)} />
                </TableCell>
              )}
              <TableCell>
                <Link href={`/documents/${d.id}`} className="hover:text-primary">
                  <Mono>{d.serial}</Mono>
                </Link>
                {notes[d.id] && <div className={`text-xs ${notes[d.id]!.warn ? "text-status-pending" : "text-status-approved"}`}>{notes[d.id]!.text}</div>}
              </TableCell>
              <TableCell className="text-sm">{t(`types.${d.type}`)}</TableCell>
              <TableCell>
                <Mono>{d.parcel?.pun}</Mono>
              </TableCell>
              <TableCell className="text-sm">{d.party?.full_name ?? "—"}</TableCell>
              <TableCell className="text-end text-xs text-muted-foreground">{format.dateTime(new Date(d.issued_at), { dateStyle: "medium" })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
