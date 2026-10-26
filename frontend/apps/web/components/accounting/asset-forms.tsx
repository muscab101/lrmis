"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input, Textarea } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { CalendarClock, HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  deleteAssetAction,
  depreciateAction,
  disposeAssetAction,
  saveAssetAction,
} from "@/app/[locale]/(staff)/accounting/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import type { Acct, Dist } from "./movement-forms";

export const CATEGORIES = [
  "land",
  "building",
  "vehicle",
  "equipment",
  "computer",
  "furniture",
  "other",
] as const;
type Category = (typeof CATEGORIES)[number];

export interface AssetLite {
  id: string;
  number: string;
  name: string;
  category: string;
  district_id: string | null;
  location: string | null;
  serial_no: string | null;
  acquired_on: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  funded_from: string;
  status: string;
  note: string | null;
  depreciated: number;
  book_value: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const moneyAccounts = (accounts: Acct[]) =>
  accounts.filter((a) => a.active && a.type === "asset" && /^11\d\d$/.test(a.code));

/** Add an asset, or change one (`row`). Cost, date and funding are fixed once depreciation started. */
export function AssetButton({
  accounts,
  districts,
  row,
}: {
  accounts: Acct[];
  districts: Dist[];
  row?: AssetLite;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const name = (a: Acct) => `${a.code} · ${locale === "so" ? a.name_so : a.name_en}`;
  const start = () => ({
    name: row?.name ?? "",
    category: (row?.category ?? "equipment") as Category,
    districtId: row?.district_id ?? "",
    location: row?.location ?? "",
    serialNo: row?.serial_no ?? "",
    acquiredOn: row?.acquired_on ?? today(),
    cost: row ? String(row.cost) : "",
    salvageValue: row ? String(row.salvage_value) : "0",
    usefulLifeMonths: row ? String(row.useful_life_months) : "60",
    fundedFrom: row?.funded_from ?? moneyAccounts(accounts).find((a) => a.is_bank)?.code ?? "3100",
    note: row?.note ?? "",
  });
  const [v, setV] = useState(start);
  const set = (k: keyof ReturnType<typeof start>) => (value: string) =>
    setV((cur) => ({ ...cur, [k]: value }));
  const locked = !!row && row.depreciated > 0;
  const surplus = accounts.find((a) => a.code === "3100");
  const openIt = () => {
    setV(start());
    setOpen(true);
  };

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
      ) : (
        <Button size="sm" onClick={openIt}>
          <Plus aria-hidden />
          {t("asset.add")}
        </Button>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={row ? t("asset.editTitle", { number: row.number }) : t("asset.add")}
        description={locked ? t("asset.lockedBody") : t("asset.addBody")}
        confirmLabel={t("save")}
        successMessage={t("saved")}
        className="max-w-2xl"
        submit={() =>
          saveAssetAction({
            id: row?.id ?? null,
            ...v,
            cost: v.cost as unknown as number,
            salvageValue: v.salvageValue as unknown as number,
            usefulLifeMonths: v.usefulLifeMonths as unknown as number,
          })
        }
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="name"
              label={t("asset.name")}
              error={fe("name")}
              required
              className="sm:col-span-2"
            >
              <Input id="name" value={v.name} onChange={(e) => set("name")(e.target.value)} />
            </Field>
            <Field id="category" label={t("asset.category")} error={fe("category")} required>
              <NativeSelect
                id="category"
                value={v.category}
                onChange={(e) => set("category")(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`asset.categories.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="districtId" label={t("district")} error={fe("districtId")}>
              <NativeSelect
                id="districtId"
                value={v.districtId}
                onChange={(e) => set("districtId")(e.target.value)}
              >
                <option value="">{t("movement.wholeOffice")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {locale === "so" ? d.name_so : d.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="acquiredOn" label={t("asset.acquiredOn")} error={fe("acquiredOn")} required>
              <Input
                id="acquiredOn"
                type="date"
                max={today()}
                disabled={locked}
                value={v.acquiredOn}
                onChange={(e) => set("acquiredOn")(e.target.value)}
              />
            </Field>
            <Field id="cost" label={t("asset.cost")} error={fe("cost")} required>
              <Input
                id="cost"
                type="number"
                min={0}
                step="0.01"
                disabled={locked}
                value={v.cost}
                onChange={(e) => set("cost")(e.target.value)}
              />
            </Field>
            <Field
              id="fundedFrom"
              label={t("asset.fundedFrom")}
              hint={t("asset.fundedFromHint")}
              error={fe("fundedFrom")}
              required
              className="sm:col-span-2"
            >
              <NativeSelect
                id="fundedFrom"
                disabled={locked}
                value={v.fundedFrom}
                onChange={(e) => set("fundedFrom")(e.target.value)}
              >
                {moneyAccounts(accounts).map((a) => (
                  <option key={a.code} value={a.code}>
                    {name(a)}
                  </option>
                ))}
                {surplus && (
                  <option value="3100">
                    {t("asset.alreadyOwned", { account: name(surplus) })}
                  </option>
                )}
              </NativeSelect>
            </Field>
            <Field
              id="usefulLifeMonths"
              label={t("asset.life")}
              hint={t("asset.lifeHint")}
              error={fe("usefulLifeMonths")}
            >
              <Input
                id="usefulLifeMonths"
                type="number"
                min={0}
                max={1200}
                step={1}
                value={v.usefulLifeMonths}
                onChange={(e) => set("usefulLifeMonths")(e.target.value)}
              />
            </Field>
            <Field
              id="salvageValue"
              label={t("asset.salvage")}
              hint={t("asset.salvageHint")}
              error={fe("salvageValue")}
            >
              <Input
                id="salvageValue"
                type="number"
                min={0}
                step="0.01"
                value={v.salvageValue}
                onChange={(e) => set("salvageValue")(e.target.value)}
              />
            </Field>
            <Field id="serialNo" label={t("asset.serial")} error={fe("serialNo")}>
              <Input
                id="serialNo"
                value={v.serialNo}
                onChange={(e) => set("serialNo")(e.target.value)}
              />
            </Field>
            <Field id="location" label={t("asset.location")} error={fe("location")}>
              <Input
                id="location"
                value={v.location}
                onChange={(e) => set("location")(e.target.value)}
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

/** Row keys for an active asset: edit, sell or write off, delete (before depreciation). */
export function AssetActions({
  row,
  accounts,
  districts,
  can,
}: {
  row: AssetLite;
  accounts: Acct[];
  districts: Dist[];
  can: { edit: boolean; dispose: boolean; delete: boolean };
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const format = useFormatter();
  const [dialog, setDialog] = useState<"dispose" | "delete" | null>(null);
  const banks = moneyAccounts(accounts);
  const [v, setV] = useState({
    date: today(),
    amount: "0",
    account: banks.find((a) => a.is_bank)?.code ?? banks[0]?.code ?? "",
    note: "",
  });
  if (row.status !== "active") return null;
  const gain = Number(v.amount || 0) - row.book_value;
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  return (
    <>
      <span className="inline-flex justify-end gap-0.5">
        {can.edit && <AssetButton accounts={accounts} districts={districts} row={row} />}
        {can.dispose && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-warning"
            aria-label={t("asset.dispose")}
            title={t("asset.dispose")}
            onClick={() => setDialog("dispose")}
          >
            <HandCoins aria-hidden />
          </Button>
        )}
        {can.delete && row.depreciated === 0 && (
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
        open={dialog === "dispose"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("asset.disposeTitle", { name: row.name })}
        description={t("asset.disposeBody", { book: usd(row.book_value) })}
        confirmLabel={t("asset.dispose")}
        destructive
        successMessage={t("asset.disposed")}
        submit={() =>
          disposeAssetAction({ id: row.id, ...v, amount: v.amount as unknown as number })
        }
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="date" label={t("date")} error={fe("date")} required>
              <Input
                id="date"
                type="date"
                min={row.acquired_on}
                max={today()}
                value={v.date}
                onChange={(e) => setV({ ...v, date: e.target.value })}
              />
            </Field>
            <Field
              id="amount"
              label={t("asset.received")}
              hint={t("asset.receivedHint")}
              error={fe("amount")}
              required
            >
              <Input
                id="amount"
                type="number"
                min={0}
                step="0.01"
                value={v.amount}
                onChange={(e) => setV({ ...v, amount: e.target.value })}
              />
            </Field>
            {Number(v.amount) > 0 && (
              <Field
                id="account"
                label={t("asset.receivedInto")}
                error={fe("account")}
                required
                className="sm:col-span-2"
              >
                <NativeSelect
                  id="account"
                  value={v.account}
                  onChange={(e) => setV({ ...v, account: e.target.value })}
                >
                  {banks.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {locale === "so" ? a.name_so : a.name_en}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <p className={`text-sm sm:col-span-2 ${gain >= 0 ? "text-success" : "text-danger"}`}>
              {gain >= 0
                ? t("asset.gain", { amount: usd(gain) })
                : t("asset.loss", { amount: usd(-gain) })}
            </p>
            <Field id="note" label={t("noteOptional")} className="sm:col-span-2">
              <Textarea
                id="note"
                rows={2}
                value={v.note}
                onChange={(e) => setV({ ...v, note: e.target.value })}
              />
            </Field>
          </div>
        )}
      </FormDialog>
      <FormDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("asset.deleteTitle", { name: row.name })}
        description={t("asset.deleteBody")}
        confirmLabel={t("delete")}
        destructive
        successMessage={t("deleted")}
        submit={() => deleteAssetAction({ id: row.id })}
      />
    </>
  );
}

/** Write off one month of depreciation for every asset that still has value to lose. */
export function DepreciateButton() {
  const t = useTranslations("accounting");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const [month, setMonth] = useState(
    `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`,
  );
  const max = new Date().toISOString().slice(0, 7);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock aria-hidden />
        {t("asset.depreciate")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("asset.depreciate")}
        description={t("asset.depreciateBody")}
        confirmLabel={t("asset.depreciateRun")}
        submit={async () => {
          const [y, m] = month.split("-").map(Number);
          const res = await depreciateAction({ year: y!, month: m! });
          if (res.ok) {
            const r = res.data as { count: number; total: number } | undefined;
            if (r && r.count > 0)
              toast.success(
                t("asset.depreciated", {
                  count: r.count,
                  amount: format.number(Number(r.total), { style: "currency", currency: "USD" }),
                }),
              );
            else toast.info(t("asset.nothingToDepreciate"));
          }
          return res;
        }}
      >
        {(fe) => (
          <Field id="month" label={t("period")} error={fe("month")} required>
            <Input
              id="month"
              type="month"
              max={max}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </Field>
        )}
      </FormDialog>
    </>
  );
}
