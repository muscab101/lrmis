"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const optText = (max: number) => z.string().trim().max(max, "validation.too_long").default("");
const account = z.string().regex(/^\d{4}$/, "validation.acct_required");
const optAccount = z.union([account, z.literal("")]).default("");
const optUuid = z.union([z.uuid(), z.literal("")]).default("");

/** Database details (VALIDATION: from_account …) shown under the field they belong to. */
function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && err.code === "VALIDATION" && map[detail]) {
    throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.acct_${detail}`] });
  }
  throw err;
}

const done = <T>(v: T) => {
  revalidatePath("/[locale]/accounting", "layout");
  revalidatePath("/[locale]/dashboard", "page");
  return v;
};

// ---- Money movements ----
const MOVEMENT_FIELDS = {
  amount: "amount",
  date: "date",
  district_id: "districtId",
  from_account: "fromAccount",
  to_account: "toAccount",
  account: "account",
  kind: "kind",
};

export const saveMovementAction = defineAction(
  "accounting.movement_save",
  z.object({
    id: z.uuid().nullable().default(null),
    kind: z.enum(["deposit", "expense", "income"]),
    districtId: optUuid,
    date: isoDate,
    fromAccount: optAccount,
    toAccount: optAccount,
    account: optAccount,
    amount: z.coerce.number().positive("validation.amount").max(100_000_000, "validation.amount"),
    party: optText(200),
    reference: optText(100),
    note: optText(500),
  }),
  async (v, ctx) => {
    try {
      const id = unwrap(
        await ctx.supabase.rpc("movement_save", {
          p_id: v.id,
          p: {
            kind: v.kind,
            district_id: v.districtId,
            date: v.date,
            from_account: v.fromAccount,
            to_account: v.toAccount,
            account: v.account,
            amount: v.amount,
            party: v.party,
            reference: v.reference,
            note: v.note,
          },
        }),
        "movement save",
      ) as string;
      return done({ id });
    } catch (err) {
      field(err, MOVEMENT_FIELDS);
    }
  },
);

export const decideMovementAction = defineAction(
  "accounting.movement_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: optText(500) }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("movement_decide", {
          p_id: v.id,
          p_approve: v.approve,
          p_note: v.note,
        }),
        "movement decide",
      );
      return done(null);
    } catch (err) {
      if (err instanceof AppFailure && err.values?.detail === "note_required") {
        throw new AppFailure("VALIDATION", err.values, { note: ["validation.note_required"] });
      }
      throw err;
    }
  },
);

export const cancelMovementAction = defineAction(
  "accounting.movement_cancel",
  z.object({
    id: z.uuid(),
    reason: z.string().trim().min(3, "validation.reason").max(500, "validation.reason_long"),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("movement_cancel", { p_id: v.id, p_reason: v.reason }),
      "movement cancel",
    );
    return done(null);
  },
);

export const deleteMovementAction = defineAction(
  "accounting.movement_delete",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("movement_delete", { p_id: v.id }), "movement delete");
    return done(null);
  },
);

// ---- Fixed assets ----
const ASSET_FIELDS = {
  name: "name",
  category: "category",
  cost: "cost",
  salvage_value: "salvageValue",
  useful_life_months: "usefulLifeMonths",
  acquired_on: "acquiredOn",
  funded_from: "fundedFrom",
  district_id: "districtId",
};

export const saveAssetAction = defineAction(
  "accounting.asset_save",
  z.object({
    id: z.uuid().nullable().default(null),
    name: z.string().trim().min(2, "validation.acct_name").max(200, "validation.too_long"),
    category: z.enum([
      "land",
      "building",
      "vehicle",
      "equipment",
      "computer",
      "furniture",
      "other",
    ]),
    districtId: optUuid,
    location: optText(200),
    serialNo: optText(100),
    acquiredOn: isoDate,
    cost: z.coerce.number().min(0, "validation.amount").max(100_000_000, "validation.amount"),
    salvageValue: z.coerce
      .number()
      .min(0, "validation.amount")
      .max(100_000_000, "validation.amount")
      .default(0),
    usefulLifeMonths: z.coerce
      .number()
      .int("validation.acct_useful_life_months")
      .min(0, "validation.acct_useful_life_months")
      .max(1200, "validation.acct_useful_life_months")
      .default(0),
    fundedFrom: optAccount,
    note: optText(500),
  }),
  async (v, ctx) => {
    try {
      const id = unwrap(
        await ctx.supabase.rpc("asset_save", {
          p_id: v.id,
          p: {
            name: v.name,
            category: v.category,
            district_id: v.districtId,
            location: v.location,
            serial_no: v.serialNo,
            acquired_on: v.acquiredOn,
            cost: v.cost,
            salvage_value: v.salvageValue,
            useful_life_months: v.usefulLifeMonths,
            funded_from: v.fundedFrom,
            note: v.note,
          },
        }),
        "asset save",
      ) as string;
      return done({ id });
    } catch (err) {
      field(err, ASSET_FIELDS);
    }
  },
);

export const depreciateAction = defineAction(
  "accounting.asset_depreciate",
  z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("asset_depreciate", { p_year: v.year, p_month: v.month }),
          "depreciate",
        ) as { count: number; total: number },
      );
    } catch (err) {
      field(err, { month: "month" });
    }
  },
);

export const disposeAssetAction = defineAction(
  "accounting.asset_dispose",
  z.object({
    id: z.uuid(),
    date: isoDate,
    amount: z.coerce.number().min(0, "validation.amount").max(100_000_000, "validation.amount"),
    account: optAccount,
    note: optText(500),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("asset_dispose", {
          p_id: v.id,
          p: { date: v.date, amount: v.amount, account: v.account, note: v.note },
        }),
        "asset dispose",
      );
      return done(null);
    } catch (err) {
      field(err, { amount: "amount", date: "date", account: "account" });
    }
  },
);

export const deleteAssetAction = defineAction(
  "accounting.asset_delete",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("asset_delete", { p_id: v.id }), "asset delete");
    return done(null);
  },
);

// ---- Chart of accounts ----
export const saveAccountAction = defineAction(
  "accounting.account_save",
  z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "validation.acct_code"),
    nameSo: z.string().trim().min(2, "validation.acct_name").max(120, "validation.too_long"),
    nameEn: z.string().trim().min(2, "validation.acct_name").max(120, "validation.too_long"),
    type: z.enum(["asset", "liability", "equity", "income", "expense"]),
    isBank: z.boolean().default(false),
    active: z.boolean().default(true),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("gl_account_save", {
          p: {
            code: v.code,
            name_so: v.nameSo,
            name_en: v.nameEn,
            type: v.type,
            is_bank: v.isBank,
            active: v.active,
          },
        }),
        "account save",
      );
      return done(null);
    } catch (err) {
      field(err, {
        code: "code",
        name_so: "nameSo",
        name_en: "nameEn",
        type: "type",
        is_bank: "isBank",
      });
    }
  },
);

export const deleteAccountAction = defineAction(
  "accounting.account_delete",
  z.object({ code: z.string().regex(/^\d{4}$/) }),
  async (v, ctx) =>
    done(
      unwrap(await ctx.supabase.rpc("gl_account_delete", { p_code: v.code }), "account delete") as
        "deleted" | "deactivated",
    ),
);

export const reverseJournalAction = defineAction(
  "accounting.journal_reverse",
  z.object({
    id: z.uuid(),
    reason: z.string().trim().min(3, "validation.reason").max(300, "validation.reason_long"),
  }),
  async (v, ctx) => {
    unwrap(
      await ctx.supabase.rpc("journal_reverse", { p_id: v.id, p_reason: v.reason }),
      "journal reverse",
    );
    return done(null);
  },
);

// ---- Commission and revenue sharing ----
const RULE_FIELDS: Record<string, string> = {
  code: "code",
  name: "name",
  party: "party",
  pct: "pct",
  effective_from: "effectiveFrom",
  effective_to: "effectiveTo",
  method: "method",
  kind: "kind",
};

export const saveRuleAction = defineAction(
  "accounting.rule_save",
  z.object({
    id: z.uuid().nullable().default(null),
    fromRule: z.uuid().nullable().default(null),
    code: z.string().trim().max(40).default(""),
    name: z.string().trim().min(2, "validation.acct_name").max(120, "validation.too_long"),
    kind: z.enum(["commission", "revenue_share", "fee"]),
    party: z.string().trim().min(2, "validation.acct_party").max(120, "validation.too_long"),
    method: z.enum(["", "cash", "cheque", "mobile_money", "card", "bank_transfer"]).default(""),
    wallet: z.enum(["", "evc_plus", "edahab", "zaad"]).default(""),
    feeTypeId: optUuid,
    districtId: optUuid,
    pct: z.coerce.number().min(0, "validation.acct_pct").max(100, "validation.acct_pct").default(0),
    fixedAmount: z.coerce
      .number()
      .min(0, "validation.acct_pct")
      .max(1_000_000, "validation.acct_pct")
      .default(0),
    effectiveFrom: isoDate,
    effectiveTo: z.union([isoDate, z.literal("")]).default(""),
    note: optText(500),
  }),
  async (v, ctx) => {
    try {
      const id = unwrap(
        await ctx.supabase.rpc("commission_rule_save", {
          p_id: v.id,
          p_from_rule: v.fromRule,
          p: {
            code: v.code,
            name: v.name,
            kind: v.kind,
            party: v.party,
            method: v.method,
            wallet: v.method === "mobile_money" ? v.wallet : "",
            fee_type_id: v.feeTypeId,
            district_id: v.districtId,
            pct: v.pct,
            fixed_amount: v.fixedAmount,
            effective_from: v.effectiveFrom,
            effective_to: v.effectiveTo,
            note: v.note,
          },
        }),
        "rule save",
      ) as string;
      return done({ id });
    } catch (err) {
      if (
        err instanceof AppFailure &&
        err.code === "CONFLICT" &&
        err.values?.detail === "code_taken"
      )
        throw new AppFailure("VALIDATION", err.values, { code: ["validation.code_taken"] });
      field(err, RULE_FIELDS);
    }
  },
);

export const approveRuleAction = defineAction(
  "accounting.rule_approve",
  z.object({ id: z.uuid() }),
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("commission_rule_approve", { p_id: v.id }),
        "rule approve",
      ) as number,
    ),
);

export const retireRuleAction = defineAction(
  "accounting.rule_retire",
  z.object({ id: z.uuid(), to: isoDate }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("commission_rule_retire", { p_id: v.id, p_to: v.to }),
        "rule retire",
      );
      return done(null);
    } catch (err) {
      field(err, { effective_to: "to" });
    }
  },
);

export const deleteRuleAction = defineAction(
  "accounting.rule_delete",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    unwrap(await ctx.supabase.rpc("commission_rule_delete", { p_id: v.id }), "rule delete");
    return done(null);
  },
);

export const createPayoutAction = defineAction(
  "accounting.payout_create",
  z.object({
    party: z.string().min(1).max(120),
    payable: account,
    upto: isoDate,
    paidFrom: account,
    reference: optText(100),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("commission_payout_create", {
          p_party: v.party,
          p_payable: v.payable,
          p_upto: v.upto,
          p_paid_from: v.paidFrom,
          p_reference: v.reference || null,
        }),
        "payout",
      );
      return done(null);
    } catch (err) {
      field(err, { paid_from: "paidFrom", upto: "upto" });
    }
  },
);

export const decidePayoutAction = defineAction(
  "accounting.payout_decide",
  z.object({ id: z.uuid(), approve: z.boolean(), note: optText(500) }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("commission_payout_decide", {
          p_id: v.id,
          p_approve: v.approve,
          p_note: v.note || null,
        }),
        "payout decide",
      );
      return done(null);
    } catch (err) {
      if (err instanceof AppFailure && err.values?.detail === "note_required")
        throw new AppFailure("VALIDATION", err.values, { note: ["validation.note_required"] });
      throw err;
    }
  },
);
