"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { Check, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  cancelMovementAction,
  decideMovementAction,
  deleteMovementAction,
  saveMovementAction,
} from "@/app/[locale]/(staff)/accounting/actions";
import { FormDialog } from "@/components/forms/form-dialog";

export type Kind = "deposit" | "expense" | "income";
export interface Acct {
  code: string;
  name_so: string;
  name_en: string;
  type: string;
  is_bank: boolean;
  active: boolean;
}
export interface Dist {
  id: string;
  name_so: string;
  name_en: string;
}
export interface MovementLite {
  id: string;
  number: string;
  kind: Kind;
  status: string;
  district_id: string | null;
  movement_date: string;
  debit_account: string;
  credit_account: string;
  amount: number;
  party: string | null;
  reference: string | null;
  note: string | null;
}

// Accounts the system fills by itself, so people can't book money to them by hand.
const NOT_EXPENSE = ["5100", "5300"];
const NOT_INCOME = ["2100", "4100", "4110", "4200", "4300", "4400"];

const money = (a: Acct) => a.active && a.type === "asset" && /^11\d\d$/.test(a.code);

/** The accounts each side of a movement may use. */
export function accountChoices(kind: Kind, accounts: Acct[]) {
  if (kind === "deposit")
    return {
      from: accounts.filter((a) => money(a) && !a.is_bank),
      to: accounts.filter((a) => money(a) && a.is_bank),
      main: [] as Acct[],
    };
  if (kind === "expense")
    return {
      from: accounts.filter(money),
      to: [] as Acct[],
      main: accounts.filter(
        (a) => a.active && a.type === "expense" && !NOT_EXPENSE.includes(a.code),
      ),
    };
  return {
    from: [] as Acct[],
    to: accounts.filter(money),
    main: accounts.filter(
      (a) =>
        a.active &&
        ["income", "equity", "liability"].includes(a.type) &&
        !NOT_INCOME.includes(a.code),
    ),
  };
}

function AccountSelect({
  id,
  value,
  onChange,
  accounts,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  accounts: Acct[];
}) {
  const locale = useLocale();
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {accounts.map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} · {locale === "so" ? a.name_so : a.name_en}
        </option>
      ))}
    </NativeSelect>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Record (or, with `row`, change while pending) a deposit, money out or other money in. */
export function MovementButton({
  kind,
  accounts,
  districts,
  row,
  districtId,
  held,
  size = "sm",
  variant = "default",
  label,
}: {
  kind: Kind;
  accounts: Acct[];
  districts: Dist[];
  row?: MovementLite;
  /** Start with this district (a deposit from the Districts tab). */
  districtId?: string;
  /** What the district holds per money account: the deposit starts from the fullest one, for all of it. */
  held?: Record<string, number>;
  size?: "sm" | "icon-sm";
  variant?: "default" | "outline" | "ghost";
  label?: string;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const [open, setOpen] = useState(false);
  const choices = accountChoices(kind, accounts);
  const heldIn = (code: string) => (held ? Number(held[code] ?? 0) : 0);
  const fullest = held
    ? [...choices.from].sort((a, b) => heldIn(b.code) - heldIn(a.code))[0]?.code
    : undefined;
  const heldAmount = (code: string) => (heldIn(code) > 0 ? heldIn(code).toFixed(2) : "");
  const start = () =>
    row
      ? {
          districtId: row.district_id ?? "",
          date: row.movement_date,
          fromAccount: kind === "income" ? "" : row.credit_account,
          toAccount: kind === "expense" ? "" : row.debit_account,
          account:
            kind === "deposit" ? "" : kind === "expense" ? row.debit_account : row.credit_account,
          amount: String(row.amount),
          party: row.party ?? "",
          reference: row.reference ?? "",
          note: row.note ?? "",
        }
      : {
          districtId: districtId ?? "",
          date: today(),
          fromAccount:
            kind === "deposit"
              ? (fullest ??
                choices.from.find((a) => a.code === "1100")?.code ??
                choices.from[0]?.code ??
                "")
              : kind === "expense"
                ? (choices.from.find((a) => a.is_bank)?.code ?? "")
                : "",
          toAccount:
            kind === "income"
              ? (choices.to.find((a) => a.is_bank)?.code ?? "")
              : kind === "deposit"
                ? (choices.to[0]?.code ?? "")
                : "",
          account:
            kind === "income" ? (choices.main.find((a) => a.code === "4500")?.code ?? "") : "",
          amount: fullest ? heldAmount(fullest) : "",
          party: "",
          reference: "",
          note: "",
        };
  const [v, setV] = useState(start);
  const set = (k: keyof ReturnType<typeof start>) => (value: string) =>
    setV((cur) => ({ ...cur, [k]: value }));
  const openIt = () => {
    setV(start());
    setOpen(true);
  };
  const title = row ? t("movement.editTitle", { number: row.number }) : t(`movement.new.${kind}`);
  const partyLabel = t(`movement.party.${kind}`);
  const refLabel = t(`movement.reference.${kind}`);

  return (
    <>
      {size === "icon-sm" ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-success"
          aria-label={t("edit")}
          title={t("edit")}
          onClick={openIt}
        >
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button size="sm" variant={variant} onClick={openIt}>
          <Plus aria-hidden />
          {label ?? t(`movement.new.${kind}`)}
        </Button>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={t(`movement.body.${kind}`)}
        confirmLabel={row ? t("save") : t("movement.record")}
        successMessage={row ? t("saved") : t("movement.recorded")}
        className="max-w-xl"
        submit={() =>
          saveMovementAction({
            id: row?.id ?? null,
            kind,
            ...v,
            amount: v.amount as unknown as number,
          })
        }
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="districtId"
              label={t("district")}
              error={fe("districtId")}
              required={kind === "deposit"}
              hint={kind === "deposit" ? undefined : t("movement.districtOptional")}
            >
              <NativeSelect
                id="districtId"
                value={v.districtId}
                onChange={(e) => set("districtId")(e.target.value)}
              >
                <option value="">{kind === "deposit" ? "—" : t("movement.wholeOffice")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {locale === "so" ? d.name_so : d.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="date" label={t("date")} error={fe("date")} required>
              <Input
                id="date"
                type="date"
                max={today()}
                value={v.date}
                onChange={(e) => set("date")(e.target.value)}
              />
            </Field>
            {kind !== "deposit" && (
              <Field
                id="account"
                label={t(`movement.mainAccount.${kind}`)}
                error={fe("account")}
                required
                className="sm:col-span-2"
              >
                <AccountSelect
                  id="account"
                  value={v.account}
                  onChange={set("account")}
                  accounts={choices.main}
                />
              </Field>
            )}
            {kind !== "income" && (
              <Field
                id="fromAccount"
                label={t(`movement.from.${kind}`)}
                error={fe("fromAccount")}
                hint={
                  held && v.fromAccount
                    ? t("movement.holds", { amount: usd(heldIn(v.fromAccount)) })
                    : undefined
                }
                required
              >
                <AccountSelect
                  id="fromAccount"
                  value={v.fromAccount}
                  onChange={(code) =>
                    // From the Districts tab the amount follows the account: all it holds.
                    setV((cur) => ({
                      ...cur,
                      fromAccount: code,
                      ...(held ? { amount: heldAmount(code) } : {}),
                    }))
                  }
                  accounts={choices.from}
                />
              </Field>
            )}
            {kind !== "expense" && (
              <Field
                id="toAccount"
                label={t(`movement.to.${kind}`)}
                error={fe("toAccount")}
                required
                hint={
                  kind === "deposit" && choices.to.length === 0 ? t("movement.noBank") : undefined
                }
              >
                <AccountSelect
                  id="toAccount"
                  value={v.toAccount}
                  onChange={set("toAccount")}
                  accounts={choices.to}
                />
              </Field>
            )}
            <Field id="amount" label={t("movement.amount")} error={fe("amount")} required>
              <Input
                id="amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={v.amount}
                onChange={(e) => set("amount")(e.target.value)}
              />
            </Field>
            <Field id="party" label={partyLabel} error={fe("party")}>
              <Input id="party" value={v.party} onChange={(e) => set("party")(e.target.value)} />
            </Field>
            <Field id="reference" label={refLabel} error={fe("reference")}>
              <Input
                id="reference"
                value={v.reference}
                onChange={(e) => set("reference")(e.target.value)}
              />
            </Field>
            <Field id="note" label={t("noteOptional")} error={fe("note")} className="sm:col-span-2">
              <Textarea
                id="note"
                rows={2}
                value={v.note}
                onChange={(e) => set("note")(e.target.value)}
              />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}

/** Row keys: confirm / reject / edit / delete while pending, cancel once confirmed, delete once rejected. */
export function MovementActions({
  row,
  accounts,
  districts,
  can,
}: {
  row: MovementLite;
  accounts: Acct[];
  districts: Dist[];
  can: { edit: boolean; approve: boolean; cancel: boolean; delete: boolean };
}) {
  const t = useTranslations("accounting");
  const [dialog, setDialog] = useState<"confirm" | "reject" | "cancel" | "delete" | null>(null);
  const [note, setNote] = useState("");
  const close = (o: boolean) => {
    if (!o) {
      setDialog(null);
      setNote("");
    }
  };
  const pending = row.status === "pending";
  return (
    <>
      <span className="inline-flex justify-end gap-0.5">
        {pending && can.approve && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-success"
              aria-label={t("movement.confirm")}
              title={t("movement.confirm")}
              onClick={() => setDialog("confirm")}
            >
              <Check aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-warning"
              aria-label={t("movement.reject")}
              title={t("movement.reject")}
              onClick={() => setDialog("reject")}
            >
              <X aria-hidden />
            </Button>
          </>
        )}
        {pending && can.edit && (
          <MovementButton
            kind={row.kind}
            accounts={accounts}
            districts={districts}
            row={row}
            size="icon-sm"
          />
        )}
        {row.status === "confirmed" && can.cancel && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-danger"
            aria-label={t("movement.cancel")}
            title={t("movement.cancel")}
            onClick={() => setDialog("cancel")}
          >
            <Undo2 aria-hidden />
          </Button>
        )}
        {(pending || row.status === "rejected") && can.delete && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-danger"
            aria-label={t("delete")}
            title={t("delete")}
            onClick={() => setDialog("delete")}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </span>
      <FormDialog
        open={dialog === "confirm"}
        onOpenChange={close}
        title={t("movement.confirmTitle", { number: row.number })}
        description={t(`movement.confirmBody.${row.kind}`)}
        confirmLabel={t("movement.confirm")}
        successMessage={t("movement.confirmed")}
        submit={() => decideMovementAction({ id: row.id, approve: true, note })}
      />
      <FormDialog
        open={dialog === "reject"}
        onOpenChange={close}
        title={t("movement.rejectTitle", { number: row.number })}
        description={t("movement.rejectBody")}
        confirmLabel={t("movement.reject")}
        destructive
        successMessage={t("movement.rejected")}
        submit={() => decideMovementAction({ id: row.id, approve: false, note })}
      >
        {(fe) => (
          <Field id="note" label={t("movement.rejectNote")} error={fe("note")} required>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title={t("movement.cancelTitle", { number: row.number })}
        description={t("movement.cancelBody")}
        confirmLabel={t("movement.cancel")}
        destructive
        successMessage={t("movement.cancelled")}
        submit={() => cancelMovementAction({ id: row.id, reason: note })}
      >
        {(fe) => (
          <Field id="reason" label={t("reason")} error={fe("reason")} required>
            <Textarea id="reason" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={t("movement.deleteTitle", { number: row.number })}
        description={t("movement.deleteBody")}
        confirmLabel={t("delete")}
        destructive
        successMessage={t("deleted")}
        submit={() => deleteMovementAction({ id: row.id })}
      />
    </>
  );
}
