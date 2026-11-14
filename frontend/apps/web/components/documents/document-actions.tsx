"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Alert, EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Ban, ChevronDown, Inbox, Printer, RefreshCw, RotateCcw, Zap } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelDocumentAction,
  printNowAction,
  reprintDirectAction,
  requestReissueAction,
  requestReprintAction,
} from "@/app/[locale]/(staff)/documents/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { GoApprove } from "@/components/approvals/go-approve";
import { usePrintNow } from "@/components/documents/use-print-now";
import { Link, useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { DocumentChange, DocumentRow, ReprintRow } from "@/lib/server/certificates";

/** A certificate ready to issue: issuing is approved on the Applications page (the one place for approvals). */
export function IssueCertificateButton({ size = "sm" }: { parcelId?: string; pun?: string; size?: "sm" | "default" }) {
  return <GoApprove tab="certificates" size={size} />;
}

type DocDialog = "reprint" | "reissue" | "direct" | "cancel";

export function DocumentActions({
  id,
  status,
  can,
  changes = [],
  pendingReason = null,
  printed = false,
  reprintReady = null,
}: {
  /** The new copy from an approved reprint request, not printed yet: Reprint now prints it. */
  reprintReady?: string | null;
  id: string;
  status: string;
  can: { reprint: boolean; cancel: boolean; direct?: boolean; print?: boolean };
  /** Printed already: a new copy goes through a reprint. */
  printed?: boolean;
  /** What a correction would change (document vs today's register). */
  changes?: DocumentChange[];
  /** Reason of a pending request, reused by a one-step reprint. */
  pendingReason?: string | null;
}) {
  const t = useTranslations("documents");
  const errorMessage = useErrorMessage();
  const locale = useLocale();
  const router = useRouter();
  const [printing, setPrinting] = useState(false);
  const reprinting = usePrintNow();
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
      {status === "valid" && can.print && !printed && (
        <Button
          size="sm"
          disabled={printing}
          onClick={async () => {
            setPrinting(true);
            const res = await printNowAction({ id, locale: locale === "en" ? "en" : "so" });
            setPrinting(false);
            if (!res.ok) return void toast.error(errorMessage(res.error));
            toast.success(
              res.data.online
                ? t("printNowSent", { printer: res.data.printer })
                : t("printNowQueued", { printer: res.data.printer }),
            );
            router.refresh();
          }}
        >
          <Printer aria-hidden />
          {printing ? t("printNowSending") : t("printNow")}
        </Button>
      )}
      {/* Everything else in one menu. A reprint is asked for first; once approved, Reprint now prints the new copy. */}
      {((status === "valid" && ((can.reprint && !pending && !reprintReady) || can.cancel)) || (reprintReady && can.print)) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              {t("moreActions")}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {reprintReady && can.print ? (
              <DropdownMenuItem onSelect={() => void reprinting.print([reprintReady])}>
                <Zap aria-hidden />
                {t("reprintNow")}
              </DropdownMenuItem>
            ) : (
              status === "valid" &&
              can.reprint &&
              !pending && (
                <>
                  <DropdownMenuItem onSelect={() => setDialog("reprint")}>
                    <RotateCcw aria-hidden />
                    {t("requestReprint")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog("reissue")}>
                    <RefreshCw aria-hidden />
                    {t("reissue")}
                  </DropdownMenuItem>
                </>
              )
            )}
            {status === "valid" && can.cancel && (
              <DropdownMenuItem className="text-danger" onSelect={() => setDialog("cancel")}>
                <Ban aria-hidden />
                {t("cancelDocument")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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

/** Reprint and reissue requests: a list to follow (they are approved on the Applications page). */
export function ReprintQueue({ rows, me, canCashier = false }: { rows: ReprintRow[]; me: string; canCashier?: boolean }) {
  const t = useTranslations("documents");
  if (rows.length === 0) return <EmptyState icon={<Inbox />} title={t("noReprints")} description={t("noReprintsBody")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("document")}</TableHead>
          <TableHead>{t("requestKind")}</TableHead>
          <TableHead>PUN</TableHead>
          <TableHead>{t("reason")}</TableHead>
          <TableHead>{t("fee")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const feeOpen = r.fee_invoice !== null && r.fee_invoice.status !== "paid" && r.fee_invoice.status !== "cancelled";
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
                {r.status === "pending" && r.requested_by === me && <span className="block text-xs text-muted-foreground">{t("waitingOther")}</span>}
                {r.status === "pending" && feeOpen && r.requested_by !== me && <span className="block text-xs text-status-pending">{t("waitingFee")}</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export interface IssueRow {
  id: string;
  pun: string;
  registered_at: string | null;
  blockers: string[];
}

/** "To issue": the registered land waiting for a certificate, and what still stops it (issued from Applications). */
export function IssueQueue({ rows }: { rows: IssueRow[] }) {
  const t = useTranslations("documents");
  const format = useFormatter();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PUN</TableHead>
          <TableHead>{t("registered")}</TableHead>
          <TableHead>{t("eligibility")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Link href={`/parcels/${p.id}`} className="hover:text-primary">
                <Mono>{p.pun}</Mono>
              </Link>
            </TableCell>
            <TableCell className="text-sm">{p.registered_at ? format.dateTime(new Date(p.registered_at), { dateStyle: "medium" }) : "—"}</TableCell>
            <TableCell className="text-sm">
              {p.blockers.length === 0 ? <span className="text-status-approved">{t("eligible")}</span> : p.blockers.map((b) => t(`blockers.${b}`)).join(" · ")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** "To print": tick documents and open them together for one print run. */
export function PrintQueue({ rows, canPrint, notes = {} }: { rows: DocumentRow[]; canPrint: boolean; notes?: Record<string, { text: string; warn: boolean }> }) {
  const t = useTranslations("documents");
  const format = useFormatter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));
  const all = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const printing = usePrintNow();
  return (
    <>
      {canPrint && (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">{t("selected", { count: picked.size })}</span>
          <Button
            size="sm"
            className="ms-auto"
            disabled={picked.size === 0}
            loading={printing.busy}
            onClick={async () => {
              if ((await printing.print([...picked])) > 0) setPicked(new Set());
            }}
          >
            <Printer aria-hidden />
            {printing.busy ? t("printNowSending") : t("printSelected", { count: picked.size })}
          </Button>
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
