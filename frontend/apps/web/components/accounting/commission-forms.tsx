"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import {
  Banknote,
  CalendarX2,
  Check,
  CopyPlus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  approveRuleAction,
  createPayoutAction,
  decidePayoutAction,
  deleteRuleAction,
  retireRuleAction,
  saveRuleAction,
} from "@/app/[locale]/(staff)/accounting/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { Acct, Dist } from "./movement-forms";

export interface RuleLite {
  id: string;
  code: string;
  version: number;
  name: string;
  kind: "commission" | "revenue_share" | "fee";
  party: string;
  method: string | null;
  wallet: string | null;
  fee_type_id: string | null;
  district_id: string | null;
  pct: number;
  fixed_amount: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  note: string | null;
  created_by: string | null;
}
export interface FeeTypeLite {
  id: string;
  name_so: string;
  name_en: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const METHODS = ["cash", "mobile_money", "bank_transfer", "card", "cheque"] as const;
const WALLETS = ["evc_plus", "edahab", "zaad"] as const;

/**
 * Draft a rule, change a draft (`row`), or start the next version of an approved one (`nextOf`).
 * A rule calculates nothing until someone other than its author approves it.
 */
export function RuleButton({
  row,
  nextOf,
  feeTypes,
  districts,
}: {
  row?: RuleLite;
  nextOf?: RuleLite;
  feeTypes: FeeTypeLite[];
  districts: Dist[];
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const base = row ?? nextOf;
  const start = () => ({
    code: base?.code ?? "",
    name: base?.name ?? "",
    kind: (base?.kind ?? "fee") as RuleLite["kind"],
    party: base?.party ?? "",
    method: (base?.method ?? "") as "" | (typeof METHODS)[number],
    wallet: (base?.wallet ?? "") as "" | (typeof WALLETS)[number],
    feeTypeId: base?.fee_type_id ?? "",
    districtId: base?.district_id ?? "",
    pct: base ? String(base.pct) : "",
    fixedAmount: base ? String(base.fixed_amount) : "0",
    effectiveFrom: nextOf ? tomorrow() : (row?.effective_from ?? today()),
    effectiveTo: row?.effective_to ?? "",
    note: row?.note ?? "",
  });
  const [v, setV] = useState(start);
  const set = (k: keyof ReturnType<typeof start>) => (value: string) =>
    setV((cur) => ({ ...cur, [k]: value }));
  const openIt = () => {
    setV(start());
    setOpen(true);
  };
  const name = (o: { name_so: string; name_en: string }) =>
    locale === "so" ? o.name_so : o.name_en;

  return (
    <>
      {row ? (
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
      ) : nextOf ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-primary"
          aria-label={t("rules.newVersion")}
          title={t("rules.newVersion")}
          onClick={openIt}
        >
          <CopyPlus aria-hidden />
        </Button>
      ) : (
        <Button size="sm" onClick={openIt}>
          <Plus aria-hidden />
          {t("rules.add")}
        </Button>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={
          row
            ? t("rules.editTitle", { code: row.code })
            : nextOf
              ? t("rules.versionTitle", { code: nextOf.code, version: nextOf.version + 1 })
              : t("rules.add")
        }
        description={nextOf ? t("rules.versionBody") : t("rules.body")}
        confirmLabel={t("rules.saveDraft")}
        successMessage={t("rules.saved")}
        className="max-w-2xl"
        submit={() =>
          saveRuleAction({
            id: row?.id ?? null,
            fromRule: nextOf?.id ?? null,
            ...v,
            pct: v.pct as unknown as number,
            fixedAmount: v.fixedAmount as unknown as number,
          })
        }
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="name" label={t("rules.name")} error={fe("name")} required>
              <Input id="name" value={v.name} onChange={(e) => set("name")(e.target.value)} />
            </Field>
            <Field
              id="code"
              label={t("code")}
              hint={t("rules.codeHint")}
              error={fe("code")}
              required
            >
              <Input
                id="code"
                className="font-mono"
                disabled={!!base}
                value={v.code}
                onChange={(e) =>
                  set("code")(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
                }
              />
            </Field>
            <Field id="kind" label={t("rules.kind")} error={fe("kind")} required>
              <NativeSelect id="kind" value={v.kind} onChange={(e) => set("kind")(e.target.value)}>
                {(["fee", "commission", "revenue_share"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`rules.kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="party"
              label={t("rules.party")}
              hint={t("rules.partyHint")}
              error={fe("party")}
              required
            >
              <Input id="party" value={v.party} onChange={(e) => set("party")(e.target.value)} />
            </Field>
            <p className="text-muted-foreground text-xs font-medium sm:col-span-2">
              {t("rules.which")}
            </p>
            <Field id="method" label={t("rules.method")} error={fe("method")}>
              <NativeSelect
                id="method"
                value={v.method}
                onChange={(e) => set("method")(e.target.value)}
              >
                <option value="">{t("rules.any")}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`rules.methods.${m}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {v.method === "mobile_money" && (
              <Field id="wallet" label={t("rules.wallet")}>
                <NativeSelect
                  id="wallet"
                  value={v.wallet}
                  onChange={(e) => set("wallet")(e.target.value)}
                >
                  <option value="">{t("rules.any")}</option>
                  {WALLETS.map((w) => (
                    <option key={w} value={w}>
                      {t(`channels.${w}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id="feeTypeId" label={t("rules.feeType")} hint={t("rules.feeTypeHint")}>
              <NativeSelect
                id="feeTypeId"
                value={v.feeTypeId}
                onChange={(e) => set("feeTypeId")(e.target.value)}
              >
                <option value="">{t("rules.any")}</option>
                {feeTypes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {name(f)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="districtId" label={t("district")}>
              <NativeSelect
                id="districtId"
                value={v.districtId}
                onChange={(e) => set("districtId")(e.target.value)}
              >
                <option value="">{t("rules.any")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {name(d)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <p className="text-muted-foreground text-xs font-medium sm:col-span-2">
              {t("rules.howMuch")}
            </p>
            <Field id="pct" label={t("rules.pct")} error={fe("pct")}>
              <Input
                id="pct"
                type="number"
                min={0}
                max={100}
                step="0.0001"
                value={v.pct}
                onChange={(e) => set("pct")(e.target.value)}
              />
            </Field>
            <Field id="fixedAmount" label={t("rules.fixed")} error={fe("fixedAmount")}>
              <Input
                id="fixedAmount"
                type="number"
                min={0}
                step="0.01"
                value={v.fixedAmount}
                onChange={(e) => set("fixedAmount")(e.target.value)}
              />
            </Field>
            <Field
              id="effectiveFrom"
              label={t("rules.from")}
              hint={nextOf ? t("rules.fromVersionHint") : t("rules.fromHint")}
              error={fe("effectiveFrom")}
              required
            >
              <Input
                id="effectiveFrom"
                type="date"
                value={v.effectiveFrom}
                onChange={(e) => set("effectiveFrom")(e.target.value)}
              />
            </Field>
            <Field id="effectiveTo" label={t("rules.to")} error={fe("effectiveTo")}>
              <Input
                id="effectiveTo"
                type="date"
                value={v.effectiveTo}
                onChange={(e) => set("effectiveTo")(e.target.value)}
              />
            </Field>
            <Field id="note" label={t("rules.contract")} className="sm:col-span-2">
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

/** Row keys: draft → edit / approve (not its author) / delete; approved → new version / stop. */
export function RuleActions({
  row,
  me,
  feeTypes,
  districts,
  can,
}: {
  row: RuleLite;
  me: string;
  feeTypes: FeeTypeLite[];
  districts: Dist[];
  can: { edit: boolean; approve: boolean };
}) {
  const t = useTranslations("accounting");
  const [dialog, setDialog] = useState<"approve" | "retire" | "delete" | null>(null);
  const [to, setTo] = useState(today());
  return (
    <>
      <span className="inline-flex justify-end gap-0.5">
        {row.status === "draft" && can.edit && (
          <RuleButton row={row} feeTypes={feeTypes} districts={districts} />
        )}
        {row.status === "draft" && can.approve && row.created_by !== me && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-success"
            aria-label={t("rules.approve")}
            title={t("rules.approve")}
            onClick={() => setDialog("approve")}
          >
            <ShieldCheck aria-hidden />
          </Button>
        )}
        {row.status === "draft" && can.edit && (
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
        {row.status === "approved" && can.edit && (
          <RuleButton nextOf={row} feeTypes={feeTypes} districts={districts} />
        )}
        {row.status === "approved" && can.approve && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-danger"
            aria-label={t("rules.retire")}
            title={t("rules.retire")}
            onClick={() => setDialog("retire")}
          >
            <CalendarX2 aria-hidden />
          </Button>
        )}
      </span>
      <FormDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("rules.approveTitle", { name: row.name })}
        description={t("rules.approveBody")}
        confirmLabel={t("rules.approve")}
        submit={async () => {
          const res = await approveRuleAction({ id: row.id });
          if (res.ok) toast.success(t("rules.approved", { count: Number(res.data ?? 0) }));
          return res;
        }}
      />
      <FormDialog
        open={dialog === "retire"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("rules.retireTitle", { name: row.name })}
        description={t("rules.retireBody")}
        confirmLabel={t("rules.retire")}
        destructive
        successMessage={t("rules.retired")}
        submit={() => retireRuleAction({ id: row.id, to })}
      >
        {(fe) => (
          <Field id="to" label={t("rules.lastDay")} error={fe("to")} required>
            <Input
              id="to"
              type="date"
              min={row.effective_from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("rules.deleteTitle", { name: row.name })}
        description={t("rules.deleteBody")}
        confirmLabel={t("delete")}
        destructive
        successMessage={t("deleted")}
        submit={() => deleteRuleAction({ id: row.id })}
      />
    </>
  );
}

/** Prepare a payout of what a party is owed up to a date. */
export function PayoutButton({
  party,
  payable,
  amount,
  accounts,
}: {
  party: string;
  payable: string;
  amount: number;
  accounts: Acct[];
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const money = accounts.filter((a) => a.active && a.type === "asset" && /^11\d\d$/.test(a.code));
  const [v, setV] = useState({
    upto: today(),
    paidFrom: money.find((a) => a.is_bank)?.code ?? money[0]?.code ?? "",
    reference: "",
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Banknote aria-hidden />
        {t("payouts.pay")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("payouts.payTitle", { party })}
        description={t("payouts.payBody", {
          amount: format.number(amount, { style: "currency", currency: "USD" }),
        })}
        confirmLabel={t("payouts.prepare")}
        successMessage={t("payouts.prepared")}
        submit={() => createPayoutAction({ party, payable, ...v })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="upto" label={t("payouts.upto")} error={fe("upto")} required>
              <Input
                id="upto"
                type="date"
                max={today()}
                value={v.upto}
                onChange={(e) => setV({ ...v, upto: e.target.value })}
              />
            </Field>
            <Field id="paidFrom" label={t("movement.from.expense")} error={fe("paidFrom")} required>
              <NativeSelect
                id="paidFrom"
                value={v.paidFrom}
                onChange={(e) => setV({ ...v, paidFrom: e.target.value })}
              >
                {money.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {locale === "so" ? a.name_so : a.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="reference" label={t("payouts.reference")} className="sm:col-span-2">
              <Input
                id="reference"
                value={v.reference}
                onChange={(e) => setV({ ...v, reference: e.target.value })}
              />
            </Field>
          </div>
        )}
      </FormDialog>
    </>
  );
}

/** A second person pays a prepared payout, or rejects it with a note. */
export function PayoutDecide({ id, number }: { id: string; number: string }) {
  const t = useTranslations("accounting");
  const [dialog, setDialog] = useState<"pay" | "reject" | null>(null);
  const [note, setNote] = useState("");
  return (
    <>
      <span className="inline-flex gap-0.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-success"
          aria-label={t("payouts.approve")}
          title={t("payouts.approve")}
          onClick={() => setDialog("pay")}
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
      </span>
      <FormDialog
        open={dialog === "pay"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("payouts.approveTitle", { number })}
        description={t("payouts.approveBody")}
        confirmLabel={t("payouts.approve")}
        successMessage={t("payouts.paid")}
        submit={() => decidePayoutAction({ id, approve: true, note })}
      />
      <FormDialog
        open={dialog === "reject"}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setNote("");
          }
        }}
        title={t("payouts.rejectTitle", { number })}
        description={t("payouts.rejectBody")}
        confirmLabel={t("movement.reject")}
        destructive
        successMessage={t("movement.rejected")}
        submit={() => decidePayoutAction({ id, approve: false, note })}
      >
        {(fe) => (
          <Field id="note" label={t("movement.rejectNote")} error={fe("note")} required>
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
