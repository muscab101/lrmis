"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.date");
const money = z.coerce.number().min(0, "validation.amount").max(10_000_000, "validation.amount");

function field(err: unknown, map: Record<string, string>): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

const done = <T>(v: T) => {
  revalidatePath("/[locale]/billing", "layout");
  revalidatePath("/[locale]/invoices", "layout");
  revalidatePath("/[locale]/parcels/[id]", "page");
  return v;
};

export const createRunAction = defineAction(
  "billing.create_run",
  z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    feeTypeId: z.uuid("validation.required"),
    districtIds: z.array(z.uuid()).min(1, "validation.districts"),
    dueDate: isoDate,
    note: z.string().max(300).default(""),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("billing_run_create", {
            p: { year: v.year, fee_type_id: v.feeTypeId, district_ids: v.districtIds, due_date: v.dueDate, note: v.note },
          }),
          "create run",
        ) as { id: string; number: string },
      );
    } catch (err) {
      field(err, { due_date: "dueDate", fee_type: "feeTypeId", districts: "districtIds", year: "year" });
    }
  },
);

const runStep = (name: string, rpc: string) =>
  defineAction(`billing.${name}`, z.object({ id: z.uuid() }), async ({ id }, ctx) => done(unwrap(await ctx.supabase.rpc(rpc, { p_id: id }), name)));

export const refreshRunAction = runStep("refresh_run", "billing_run_refresh");
export const submitRunAction = runStep("submit_run", "billing_run_submit");
export const approveRunAction = runStep("approve_run", "billing_run_approve");
export const generateRunAction = runStep("generate_run", "billing_run_generate");

export const cancelRunAction = defineAction("billing.cancel_run", z.object({ id: z.uuid(), reason: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("billing_run_cancel", { p_id: v.id, p_reason: v.reason }), "cancel run");
  } catch (err) {
    field(err, { note_required: "reason" });
  }
  return done(null);
});

export const createInvoiceAction = defineAction(
  "invoices.create",
  z.object({ parcelId: z.uuid(), feeTypeId: z.uuid("validation.required"), amount: money.nullable(), note: z.string().max(300).default("") }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(await ctx.supabase.rpc("invoice_create", { p_parcel: v.parcelId, p_fee_type: v.feeTypeId, p_amount: v.amount, p_note: v.note }), "create invoice") as {
          id: string;
          number: string;
        },
      );
    } catch (err) {
      field(err, { amount: "amount", fee_type: "feeTypeId" });
    }
  },
);

export const cancelInvoiceAction = defineAction("invoices.cancel", z.object({ id: z.uuid(), reason: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("invoice_cancel", { p_id: v.id, p_reason: v.reason }), "cancel invoice");
  } catch (err) {
    field(err, { note_required: "reason" });
  }
  return done(null);
});

export const requestCreditNoteAction = defineAction(
  "invoices.credit_note",
  z.object({ invoiceId: z.uuid(), amount: z.coerce.number().positive("validation.amount"), reason: z.string().trim().min(5, "validation.reason").max(500) }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("credit_note_request", { p_invoice: v.invoiceId, p_amount: v.amount, p_reason: v.reason }), "credit note");
    } catch (err) {
      field(err, { amount: "amount", reason: "reason" });
    }
    return done(null);
  },
);

export const decideCreditNoteAction = defineAction(
  "invoices.decide_credit_note",
  z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).default("") }),
  async (v, ctx) => {
    try {
      unwrap(await ctx.supabase.rpc("credit_note_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "decide credit note");
    } catch (err) {
      field(err, { note_required: "note" });
    }
    return done(null);
  },
);

export const requestPlanAction = defineAction(
  "billing.request_plan",
  z.object({
    parcelId: z.uuid(),
    invoiceIds: z.array(z.uuid()).min(1, "validation.invoices"),
    instalments: z.coerce.number().int().min(2, "validation.instalments").max(36, "validation.instalments"),
    startDate: isoDate,
    note: z.string().max(300).default(""),
  }),
  async (v, ctx) => {
    try {
      unwrap(
        await ctx.supabase.rpc("payment_plan_request", { p_parcel: v.parcelId, p_invoice_ids: v.invoiceIds, p_instalments: v.instalments, p_start: v.startDate, p_note: v.note }),
        "plan",
      );
    } catch (err) {
      field(err, { instalments: "instalments", start_date: "startDate", invoices: "invoiceIds" });
    }
    return done(null);
  },
);

export const decidePlanAction = defineAction("billing.decide_plan", z.object({ id: z.uuid(), approve: z.boolean(), note: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    unwrap(await ctx.supabase.rpc("payment_plan_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "decide plan");
  } catch (err) {
    field(err, { note_required: "note" });
  }
  return done(null);
});

export const applyPenaltiesAction = defineAction("billing.penalties", z.object({}), async (_v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("apply_late_penalties", {}), "penalties") as number),
);

/** Single invoice: find the parcel by PUN or account number first. */
export const findParcelAction = defineAction("invoices.find_parcel", z.object({ q: z.string().trim().min(3).max(40) }), async (v, ctx) => {
  const term = v.q.toUpperCase();
  const { data } = await ctx.supabase
    .from("parcels")
    .select("id, pun, account_no, status, district:districts(name_so, name_en), parcel_owners(valid_to, party:parties(full_name))")
    .or(`pun.eq.${term},account_no.eq.${term}`)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const p = data as unknown as { id: string; pun: string | null; account_no: string | null; status: string; district: { name_so: string; name_en: string } | null; parcel_owners: { valid_to: string | null; party: { full_name: string } | null }[] };
  return { id: p.id, pun: p.pun, accountNo: p.account_no, status: p.status, district: p.district, owners: p.parcel_owners.filter((o) => !o.valid_to).map((o) => o.party?.full_name ?? "") };
});
