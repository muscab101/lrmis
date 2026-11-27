"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Inbox } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import {
  matchPaymentAction,
  bankAccountSetAction,
  toggleProviderAction,
} from "@/app/[locale]/(staff)/payments/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { GoApprove } from "@/components/approvals/go-approve";
import { Link, useRouter } from "@/i18n/navigation";
import type { PaymentRow, ReversalRow, ShiftRow } from "@/lib/server/payments";
import type { BankAccount } from "@/lib/server/bank-account";

const usdFmt = (format: ReturnType<typeof useFormatter>) => (n: number | null) =>
  n == null ? "—" : format.number(Number(n), { style: "currency", currency: "USD" });

export function UnmatchedList({ rows, canMatch }: { rows: PaymentRow[]; canMatch: boolean }) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  const [target, setTarget] = useState<PaymentRow | null>(null);
  const [pun, setPun] = useState("");
  if (rows.length === 0)
    return (
      <EmptyState icon={<Inbox />} title={t("noUnmatched")} description={t("noUnmatchedBody")} />
    );
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("receipt")}</TableHead>
            <TableHead>{t("provider")}</TableHead>
            <TableHead>{t("reference")}</TableHead>
            <TableHead className="text-end">{t("amount")}</TableHead>
            <TableHead>{t("received")}</TableHead>
            {canMatch && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/payments/${r.id}`} className="hover:text-primary">
                  <Mono>{r.receipt_no}</Mono>
                </Link>
              </TableCell>
              <TableCell className="text-sm">{r.provider}</TableCell>
              <TableCell className="text-sm">
                <Mono>{r.reference ?? r.provider_ref}</Mono>
                {r.payer_phone && (
                  <span className="text-muted-foreground block text-xs">{r.payer_phone}</span>
                )}
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">{usd(r.amount_base)}</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {format.dateTime(new Date(r.received_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </TableCell>
              {canMatch && (
                <TableCell className="text-end">
                  <Button size="sm" onClick={() => setTarget(r)}>
                    {t("match")}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <FormDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setPun("");
          }
        }}
        title={t("matchTitle")}
        description={
          target
            ? t("matchBody", { receipt: target.receipt_no, amount: usd(target.amount_base) })
            : ""
        }
        confirmLabel={t("match")}
        successMessage={t("matched")}
        submit={() => matchPaymentAction({ id: target!.id, pun })}
      >
        {(fe) => (
          <Field id="pun" label={t("pun")} error={fe("pun")} required>
            <Input value={pun} onChange={(e) => setPun(e.target.value)} className="font-mono" />
          </Field>
        )}
      </FormDialog>
    </>
  );
}

export function ReversalQueue({
  rows,
  me,
  canDecide,
}: {
  rows: ReversalRow[];
  me: string;
  canDecide: boolean;
}) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  if (rows.length === 0)
    return (
      <EmptyState icon={<Inbox />} title={t("noReversals")} description={t("noReversalsBody")} />
    );
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("receipt")}</TableHead>
            <TableHead>{t("pun")}</TableHead>
            <TableHead className="text-end">{t("amount")}</TableHead>
            <TableHead>{t("reason")}</TableHead>
            <TableHead>{t("statusLabel")}</TableHead>
            {canDecide && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/payments/${r.payment?.id}`} className="hover:text-primary">
                  <Mono>{r.payment?.receipt_no}</Mono>
                </Link>
              </TableCell>
              <TableCell>
                <Mono>{r.payment?.parcel?.pun ?? "—"}</Mono>
              </TableCell>
              <TableCell className="text-end text-sm tabular-nums">
                {usd(r.payment?.amount_base ?? null)}
              </TableCell>
              <TableCell className="max-w-xs text-sm">{r.reason}</TableCell>
              <TableCell className="text-sm">{t(`decision.${r.status}`)}</TableCell>
              {canDecide && (
                <TableCell className="whitespace-nowrap text-end">
                  {r.status === "pending" && r.requested_by !== me && (
                    <GoApprove tab="accounting" iconOnly />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

export function ShiftApprovals({
  rows,
  me,
  canApprove,
}: {
  rows: ShiftRow[];
  me: string;
  canApprove: boolean;
}) {
  const t = useTranslations("payments");
  const format = useFormatter();
  const usd = usdFmt(format);
  if (rows.length === 0)
    return <EmptyState icon={<Inbox />} title={t("noShifts")} description={t("noShiftsBody")} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("shift")}</TableHead>
          <TableHead>{t("pointOfSale")}</TableHead>
          <TableHead className="text-end">{t("expected")}</TableHead>
          <TableHead className="text-end">{t("counted")}</TableHead>
          <TableHead className="text-end">{t("difference")}</TableHead>
          <TableHead>{t("statusLabel")}</TableHead>
          {canApprove && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Mono>{s.number}</Mono>
              <span className="text-muted-foreground block text-xs">
                {format.dateTime(new Date(s.opened_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </TableCell>
            <TableCell className="text-sm">{s.pos?.name}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(s.expected_cash)}</TableCell>
            <TableCell className="text-end text-sm tabular-nums">{usd(s.counted_cash)}</TableCell>
            <TableCell
              className={`text-end text-sm tabular-nums ${Number(s.difference ?? 0) !== 0 ? "text-status-rejected" : ""}`}
            >
              {usd(s.difference)}
              {s.close_note && (
                <span className="text-muted-foreground block text-xs">{s.close_note}</span>
              )}
            </TableCell>
            <TableCell className="text-sm">{t(`shiftStatus.${s.status}`)}</TableCell>
            {canApprove && (
              <TableCell className="text-end">
                {s.status === "closed" && s.cashier_id !== me && (
                  <GoApprove tab="accounting" iconOnly />
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ProviderToggles({
  providers,
  configured,
  canEdit,
}: {
  providers: { code: string; name: string; enabled: boolean }[];
  configured: Record<string, boolean | undefined>;
  canEdit: boolean;
}) {
  const t = useTranslations("payments");
  const router = useRouter();
  return (
    <ul className="divide-y">
      {providers.map((p) => (
        <li key={p.code} className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="font-medium">{p.name}</p>
            <p className="text-muted-foreground text-xs">
              {configured[p.code] === undefined
                ? t("providerOffline")
                : configured[p.code]
                  ? t("providerConfigured")
                  : t("providerNotConfigured")}
            </p>
          </div>
          <Switch
            checked={p.enabled}
            disabled={!canEdit}
            aria-label={p.name}
            onCheckedChange={async (on) => {
              const res = await toggleProviderAction({ code: p.code, enabled: on });
              if (res.ok) router.refresh();
              else toast.error(t("actionFailed"));
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** The bank account citizens pay into by transfer; they write their PUN as the reference. */
export function BankAccountForm({ initial, canEdit }: { initial: BankAccount; canEdit: boolean }) {
  const t = useTranslations("payments");
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const fields: (keyof BankAccount)[] = ["bank", "account_name", "account_no", "branch", "swift"];
  return (
    <form
      className="space-y-3 border-t p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await bankAccountSetAction(v);
        setBusy(false);
        if (res.ok) {
          toast.success(t("bankAccountSaved"));
          router.refresh();
        } else toast.error(t("actionFailed"));
      }}
    >
      <div>
        <p className="font-medium">{t("bankAccountTitle")}</p>
        <p className="text-muted-foreground text-xs">{t("bankAccountBody")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((k) => (
          <Field key={k} id={`bank-${k}`} label={t(`bankField_${k}`)}>
            <Input value={v[k]} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      {canEdit && (
        <Button type="submit" size="sm" loading={busy}>
          {t("bankAccountSave")}
        </Button>
      )}
    </form>
  );
}
