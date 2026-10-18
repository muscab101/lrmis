"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const id = z.uuid();
const audience = z.object({
  kind: z.enum(["overdue", "tax_due", "owners"]),
  min_days: z.coerce.number().int().min(0).max(3650).optional(),
  period: z.string().regex(/^\d{4}$/, "validation.year").optional(),
  text: z.string().trim().max(400).optional(),
});
const campaignSchema = z.object({
  template: z.enum(["overdue_reminder", "tax_due", "general_notice"]),
  audience,
  district: z.uuid().nullable(),
  note: z.string().max(500).default(""),
});

const done = <T>(v: T) => {
  revalidatePath("/[locale]/messages", "page");
  return v;
};

function mapField(err: unknown): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  const map: Record<string, string> = { text: "text", district: "district", no_recipients: "audience", too_many_recipients: "audience", note_required: "note", body: "body_so", body_long: "body_so" };
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

export const previewCampaignAction = defineAction("messages.preview", campaignSchema, async (v, ctx) => {
  try {
    return unwrap(await ctx.supabase.rpc("campaign_preview", { p_template: v.template, p_audience: v.audience, p_district: v.district }), "preview") as {
      recipients: number;
      sample_so: string | null;
      sample_en: string | null;
    };
  } catch (err) {
    mapField(err);
  }
});

export const createCampaignAction = defineAction("messages.campaign", campaignSchema, async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("campaign_create", { p_template: v.template, p_audience: v.audience, p_district: v.district, p_note: v.note }), "campaign"));
  } catch (err) {
    mapField(err);
  }
});

export const decideCampaignAction = defineAction("messages.decide", z.object({ id, approve: z.boolean(), note: z.string().max(500).default("") }), async (v, ctx) => {
  try {
    return done(unwrap(await ctx.supabase.rpc("campaign_decide", { p_id: v.id, p_approve: v.approve, p_note: v.note }), "campaign"));
  } catch (err) {
    mapField(err);
  }
});

export const retryMessageAction = defineAction("messages.retry", z.object({ id }), async (v, ctx) => done(unwrap(await ctx.supabase.rpc("message_retry", { p_id: v.id }), "message")));
export const cancelMessageAction = defineAction("messages.cancel", z.object({ id }), async (v, ctx) => done(unwrap(await ctx.supabase.rpc("message_cancel", { p_id: v.id }), "message")));

export const updateTemplateAction = defineAction(
  "messages.template",
  z.object({ code: z.string().regex(/^[a-z_]+$/), bodySo: z.string().trim().min(1, "validation.required").max(640, "validation.too_long"), bodyEn: z.string().trim().min(1, "validation.required").max(640, "validation.too_long"), active: z.boolean() }),
  async (v, ctx) => {
    try {
      return done(unwrap(await ctx.supabase.rpc("message_template_update", { p_code: v.code, p_body_so: v.bodySo, p_body_en: v.bodyEn, p_active: v.active }), "template"));
    } catch (err) {
      mapField(err);
    }
  },
);

/** SMS Management → Single SMS. */
export const sendSmsAction = defineAction(
  "messages.send",
  z.object({ phone: z.string().trim().min(6, "validation.phone").max(20), text: z.string().trim().min(5, "validation.text").max(600, "validation.too_long"), partyId: z.uuid().nullable().default(null) }),
  async (v, ctx) => {
    try {
      return done(unwrap(await ctx.supabase.rpc("message_send", { p_phone: v.phone, p_text: v.text, p_party: v.partyId }), "send") as string);
    } catch (err) {
      const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
      if (detail === "phone") throw new AppFailure("VALIDATION", undefined, { phone: ["validation.phone"] });
      if (detail === "text") throw new AppFailure("VALIDATION", undefined, { text: ["validation.text"] });
      throw err;
    }
  },
);
