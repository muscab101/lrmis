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
    /** Optional: only these places inside the districts (none = the whole districts). */
    sectionIds: z.array(z.uuid()).default([]),
    sectorIds: z.array(z.uuid()).default([]),
    neighbourhoodIds: z.array(z.uuid()).default([]),
    dueDate: isoDate,
    note: z.string().max(300).default(""),
  }),
  async (v, ctx) => {
    try {
      return done(
        unwrap(
          await ctx.supabase.rpc("billing_run_create", {
            p: {
              year: v.year,
              fee_type_id: v.feeTypeId,
              district_ids: v.districtIds,
              section_ids: v.sectionIds,
              sector_ids: v.sectorIds,
              neighbourhood_ids: v.neighbourhoodIds,
              due_date: v.dueDate,
              note: v.note,
            },
          }),
          "create run",
        ) as { id: string; number: string },
      );
    } catch (err) {
      field(err, { due_date: "dueDate", fee_type: "feeTypeId", districts: "districtIds", year: "year", places: "places", neighbourhoods: "places" });
    }
  },
);

const runStep = (name: string, rpc: string) =>
  defineAction(`billing.${name}`, z.object({ id: z.uuid() }), async ({ id }, ctx) => done(unwrap(await ctx.supabase.rpc(rpc, { p_id: id }), name)));

export const refreshRunAction = runStep("refresh_run", "billing_run_refresh");
export const submitRunAction = runStep("submit_run", "billing_run_submit");
export const approveRunAction = runStep("approve_run", "billing_run_approve");
export const generateRunAction = runStep("generate_run", "billing_run_generate");
/** Issue the bills now, without the approval step. */
export const issueNowRunAction = runStep("issue_now_run", "billing_run_issue_now");

/** The places of the chosen districts for a new run: their sections, the sectors of chosen sections, the neighbourhoods of chosen sectors. */
export const billingPlacesAction = defineAction(
  "billing.places",
  z.object({ districtIds: z.array(z.uuid()).max(30), sectionIds: z.array(z.uuid()).max(200), sectorIds: z.array(z.uuid()).max(500) }),
  async (v, ctx) => {
    type Place = { id: string; code: string; name_so: string; name_en: string };
    const pick = "id, code, name_so, name_en";
    const [sections, sectors, neighbourhoods] = await Promise.all([
      v.districtIds.length ? ctx.supabase.from("sections").select(pick).in("district_id", v.districtIds).is("deleted_at", null).order("code") : null,
      v.sectionIds.length ? ctx.supabase.from("sectors").select(pick).in("section_id", v.sectionIds).is("deleted_at", null).order("code") : null,
      v.sectorIds.length ? ctx.supabase.from("neighbourhoods").select(pick).in("sector_id", v.sectorIds).is("deleted_at", null).order("code").limit(1000) : null,
    ]);
    return {
      sections: (sections?.data ?? []) as Place[],
      sectors: (sectors?.data ?? []) as Place[],
      neighbourhoods: (neighbourhoods?.data ?? []) as Place[],
    };
  },
);

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
