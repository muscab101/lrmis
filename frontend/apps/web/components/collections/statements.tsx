"use client";

import type { ActionResult } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import {
  Check,
  Link2,
  MessageSquareText,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  decideBatchAction,
  deleteBatchAction,
  matchLineAction,
  resolveLineAction,
  statementCandidatesAction,
  submitBatchAction,
  uploadStatementAction,
} from "@/app/[locale]/(staff)/collections/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";

const today = () => new Date().toISOString().slice(0, 10);

/** Upload a wallet or bank statement (CSV or Excel, or pasted lines) for a provider and dates. */
export function StatementUploadButton({
  providers,
}: {
  providers: { code: string; name: string }[];
}) {
  const t = useTranslations("collections");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    provider: providers[0]?.code ?? "",
    from: today(),
    to: today(),
    text: "",
  });
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Upload aria-hidden />
        {t("statements.upload")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("statements.upload")}
        description={t("statements.uploadBody")}
        confirmLabel={t("statements.compare")}
        className="max-w-xl"
        submit={() => {
          const fd = new FormData();
          for (const [k, val] of Object.entries(v)) fd.set(k, val);
          if (file) fd.set("file", file);
          return uploadStatementAction(fd) as Promise<ActionResult<unknown>>;
        }}
        onDone={(d) => router.push(`/collections?tab=statements&batch=${(d as { id: string }).id}`)}
      >
        {(fe) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="provider" label={t("statements.provider")} required>
                <NativeSelect
                  id="provider"
                  value={v.provider}
                  onChange={(e) => setV({ ...v, provider: e.target.value })}
                >
                  {providers.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="from" label={t("from")} error={fe("from")} required>
                <Input
                  id="from"
                  type="date"
                  max={today()}
                  value={v.from}
                  onChange={(e) => setV({ ...v, from: e.target.value })}
                />
              </Field>
              <Field id="to" label={t("to")} error={fe("to")} required>
                <Input
                  id="to"
                  type="date"
                  max={today()}
                  value={v.to}
                  onChange={(e) => setV({ ...v, to: e.target.value })}
                />
              </Field>
            </div>
            <Field
              id="file"
              label={t("statements.file")}
              hint={t("statements.fileHint")}
              error={fe("file")}
            >
              <Input
                id="file"
                type="file"
                accept=".csv,.txt,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            {!file && (
              <Field id="text" label={t("statements.paste")}>
                <Textarea
                  id="text"
                  rows={5}
                  className="font-mono text-xs"
                  value={v.text}
                  onChange={(e) => setV({ ...v, text: e.target.value })}
                  placeholder={"reference,amount,date\nMP261026.1234.A12345,25.00,2026-10-26"}
                />
              </Field>
            )}
          </div>
        )}
      </FormDialog>
    </>
  );
}

type Candidate = {
  payment_id: string;
  receipt_no: string;
  reference: string | null;
  amount: number;
  received_at: string;
  payer_name: string | null;
};

/** On one statement line: match it to a payment by hand (only "not in the system" lines), or explain the difference. */
export function LineActions({
  line,
  status,
  explained,
  canMatch,
}: {
  line: number;
  status: string;
  explained: boolean;
  canMatch: boolean;
}) {
  const t = useTranslations("collections");
  const format = useFormatter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const [dialog, setDialog] = useState<"match" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState("");
  const load = async (query: string) => {
    const res = await statementCandidatesAction({ line, q: query });
    setCands(res.ok ? (res.data ?? []) : []);
  };
  const close = (o: boolean) => {
    if (!o) {
      setDialog(null);
      setNote("");
      setPick("");
    }
  };
  return (
    <>
      <span className="inline-flex justify-end gap-0.5">
        {canMatch && status === "missing_in_system" && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-primary"
            aria-label={t("statements.match")}
            title={t("statements.match")}
            onClick={() => {
              setDialog("match");
              void load("");
            }}
          >
            <Link2 aria-hidden />
          </Button>
        )}
        {status !== "matched" && (
          <Button
            size="icon-sm"
            variant="ghost"
            className={explained ? "text-muted-foreground" : "text-warning"}
            aria-label={t("statements.explain")}
            title={t("statements.explain")}
            onClick={() => setDialog("resolve")}
          >
            <MessageSquareText aria-hidden />
          </Button>
        )}
      </span>
      <FormDialog
        open={dialog === "match"}
        onOpenChange={close}
        title={t("statements.matchTitle")}
        description={t("statements.matchBody")}
        confirmLabel={t("statements.match")}
        successMessage={t("statements.matched")}
        className="max-w-2xl"
        submit={() => matchLineAction({ line, paymentId: pick, note })}
      >
        {(fe) => (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("statements.searchPayments")}
                aria-label={t("statements.searchPayments")}
              />
              <Button type="button" variant="outline" onClick={() => void load(q)}>
                {t("apply")}
              </Button>
            </div>
            <div className="max-h-64 divide-y overflow-auto rounded-md border text-sm">
              {cands === null ? (
                <p className="text-muted-foreground p-3">…</p>
              ) : cands.length === 0 ? (
                <p className="text-muted-foreground p-3">{t("statements.noCandidates")}</p>
              ) : (
                cands.map((c) => (
                  <label
                    key={c.payment_id}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${pick === c.payment_id ? "bg-primary-soft" : "hover:bg-muted/50"}`}
                  >
                    <input
                      type="radio"
                      name="pick"
                      checked={pick === c.payment_id}
                      onChange={() => setPick(c.payment_id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-xs">{c.receipt_no}</span> ·{" "}
                      <span className="font-mono text-xs">{c.reference ?? "—"}</span>
                      <span className="text-muted-foreground block text-xs">
                        {format.dateTime(new Date(c.received_at), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {c.payer_name ? ` · ${c.payer_name}` : ""}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{usd(c.amount)}</span>
                  </label>
                ))
              )}
            </div>
            {fe("paymentId") && <p className="text-danger text-sm">{fe("paymentId")}</p>}
            <Field id="note" label={t("statements.why")} error={fe("note")} required>
              <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "resolve"}
        onOpenChange={close}
        title={t("statements.explainTitle")}
        description={t("statements.explainBody")}
        confirmLabel={t("statements.explain")}
        successMessage={t("statements.explained")}
        submit={() => resolveLineAction({ line, note })}
      >
        {(fe) => (
          <Field id="note" label={t("statements.why")} error={fe("note")} required>
            <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

/** Batch keys: submit (when worked), approve / reject (a second person), delete (a wrong upload). */
export function BatchActions({
  id,
  number,
  status,
  open,
  can,
}: {
  id: string;
  number: string;
  status: string;
  /** Lines still unexplained. */
  open: number;
  can: { work: boolean; approve: boolean; selfMade: boolean };
}) {
  const t = useTranslations("collections");
  const [dialog, setDialog] = useState<"submit" | "approve" | "reject" | "delete" | null>(null);
  const [note, setNote] = useState("");
  const close = (o: boolean) => {
    if (!o) {
      setDialog(null);
      setNote("");
    }
  };
  const editable = status === "open" || status === "rejected";
  return (
    <>
      <span className="flex flex-wrap gap-2">
        {editable && can.work && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setDialog("delete")}
            >
              <Trash2 aria-hidden />
              {t("statements.delete")}
            </Button>
            <Button
              size="sm"
              disabled={open > 0}
              title={open > 0 ? t("statements.stillOpen", { count: open }) : undefined}
              onClick={() => setDialog("submit")}
            >
              <Send aria-hidden />
              {t("statements.submit")}
            </Button>
          </>
        )}
        {status === "submitted" && can.approve && !can.selfMade && (
          <>
            <Button size="sm" variant="outline" onClick={() => setDialog("reject")}>
              <X aria-hidden />
              {t("statements.reject")}
            </Button>
            <Button size="sm" onClick={() => setDialog("approve")}>
              <ShieldCheck aria-hidden />
              {t("statements.approve")}
            </Button>
          </>
        )}
        {status === "submitted" && can.approve && can.selfMade && (
          <span className="text-muted-foreground text-sm">{t("statements.notYours")}</span>
        )}
        {status === "approved" && (
          <span className="text-success inline-flex items-center gap-1 text-sm">
            <Check className="size-4" aria-hidden />
            {t("statements.locked")}
          </span>
        )}
      </span>
      <FormDialog
        open={dialog === "submit"}
        onOpenChange={close}
        title={t("statements.submitTitle", { number })}
        description={t("statements.submitBody")}
        confirmLabel={t("statements.submit")}
        successMessage={t("statements.submitted")}
        submit={() => submitBatchAction({ id, note })}
      >
        {() => (
          <Field id="note" label={t("statements.noteOptional")}>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "approve"}
        onOpenChange={close}
        title={t("statements.approveTitle", { number })}
        description={t("statements.approveBody")}
        confirmLabel={t("statements.approve")}
        successMessage={t("statements.approved")}
        submit={() => decideBatchAction({ id, approve: true, note })}
      />
      <FormDialog
        open={dialog === "reject"}
        onOpenChange={close}
        title={t("statements.rejectTitle", { number })}
        description={t("statements.rejectBody")}
        confirmLabel={t("statements.reject")}
        destructive
        successMessage={t("statements.rejected")}
        submit={() => decideBatchAction({ id, approve: false, note })}
      >
        {(fe) => (
          <Field id="note" label={t("statements.why")} error={fe("note")} required>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={t("statements.deleteTitle", { number })}
        description={t("statements.deleteBody")}
        confirmLabel={t("statements.delete")}
        destructive
        successMessage={t("statements.deleted")}
        submit={() => deleteBatchAction({ id })}
      />
    </>
  );
}
