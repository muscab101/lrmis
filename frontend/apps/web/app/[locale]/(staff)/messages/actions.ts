"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";

const id = z.uuid();
const done = <T>(v: T) => {
  revalidatePath("/[locale]/messages", "page");
  revalidatePath("/[locale]/messages/[id]", "page");
  return v;
};

function mapField(err: unknown): never {
  const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
  const map: Record<string, string> = { text: "text", district: "district", no_recipients: "audience", too_many_recipients: "audience", note_required: "note", body: "body_so", body_long: "body_so" };
  if (err instanceof AppFailure && map[detail]) throw new AppFailure(err.code, err.values, { [map[detail]!]: [`validation.${detail}`] });
  throw err;
}

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

/** A warning that shows on every open screen in the system for 5 seconds (admins only). */
export const systemWarningSendAction = defineAction(
  "messages.warning",
  z.object({
    message: z.string().trim().min(3, "validation.warning_message").max(300, "validation.warning_message"),
    /** One district, or null for every district. */
    district: z.uuid().nullable(),
  }),
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("system_warning_send", { p_message: v.message, p_district: v.district }),
        "warning",
      ) as string,
    ),
);

// ---- Compose: messages written by hand to chosen owners or whole areas (0289) ----

const ids = z.array(z.uuid()).max(1000).default([]);
const target = z.object({ all: z.boolean().default(false), owners: ids, districts: ids, sections: ids, sectors: ids, neighbourhoods: ids });
const channel = z.enum(["sms", "email"]);
const lang = z.enum(["so", "en"]);
const level = z.enum(["district", "section", "sector", "neighbourhood"]);

export interface ComposePreview {
  owners: number;
  /** One per owner, or one per owner and land when sent per property. */
  messages: number;
  all: boolean;
  /** The first owner's values, to fill the message in while it is typed. */
  sample_vars: Record<string, string> | null;
  valid: number;
  missing: number;
  invalid: number;
  duplicates: number;
  areas: { level: string; code: string; name_so: string; name_en: string }[];
  sample: string | null;
  rows: { party_id: string; parcel_id: string | null; name: string; address: string | null; state: "ok" | "missing" | "invalid" | "duplicate" }[];
}

export interface AreaChoice {
  id: string;
  code: string;
  name_so: string;
  name_en: string;
  owners: number;
  allowed: boolean;
}

export interface OwnerChoice {
  id: string;
  full_name: string;
  phone: string | null;
  id_number: string | null;
  properties: string | null;
  district: string | null;
}

/** Districts, sections, sectors or neighbourhoods to pick from, under one parent. */
export const composeAreasAction = defineAction("messages.areas", z.object({ level, parent: z.uuid().nullable() }), async (v, ctx) =>
  (unwrap(await ctx.supabase.rpc("compose_areas", { p_level: v.level, p_parent: v.parent }), "areas") ?? []) as AreaChoice[],
);

/** Owners the user may message, by name, ID number, phone or land number. */
export const searchOwnersAction = defineAction("messages.owners", z.object({ q: z.string().trim().max(80) }), async (v, ctx) =>
  (unwrap(await ctx.supabase.rpc("compose_search_owners", { p_q: v.q }), "owners") ?? []) as OwnerChoice[],
);

/** The check before sending: who gets it, which phones are missing, wrong or the same, and the message as they read it. */
export const composePreviewAction = defineAction(
  "messages.compose_preview",
  z.object({
    target,
    lang,
    channel,
    body: z.string().max(1000).default(""),
    allowDuplicates: z.boolean().default(false),
    perParcel: z.boolean().default(false),
  }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("compose_preview", {
        p: { target: v.target, lang: v.lang, channel: v.channel, body: v.body, allow_duplicates: v.allowDuplicates, per_parcel: v.perParcel },
      }),
      "preview",
    ) as ComposePreview,
);

/** Send (or schedule) the message. expect = the good phones the sender saw in the check. */
export const composeSendAction = defineAction(
  "messages.compose_send",
  z.object({
    target,
    lang,
    channel,
    template: z.string().regex(/^[a-z_]+$/).nullable().default(null),
    title: z.string().trim().max(120).default(""),
    category: z.enum(["tax_reminder", "tax_invoice", "payment_confirmation", "outstanding_tax", "general", "government", "custom"]),
    body: z.string().trim().min(2, "validation.required").max(1000, "validation.too_long"),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
    allowDuplicates: z.boolean().default(false),
    perParcel: z.boolean().default(false),
    expect: z.number().int().min(1),
  }),
  async (v, ctx) =>
    done(
      unwrap(
        await ctx.supabase.rpc("compose_send", {
          p: {
            target: v.target,
            lang: v.lang,
            channel: v.channel,
            template: v.template,
            title: v.title,
            category: v.category,
            body: v.body,
            scheduled_at: v.scheduledAt,
            allow_duplicates: v.allowDuplicates,
            per_parcel: v.perParcel,
            expect: v.expect,
          },
        }),
        "send",
      ) as { id: string; number: string; queued: number; scheduled_at: string | null },
    ),
);

/** Send again every failed message of a campaign. */
export const retryCampaignAction = defineAction("messages.retry_campaign", z.object({ id }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("campaign_retry_failed", { p_id: v.id }), "retry") as number),
);

/** Stop the messages of a campaign that have not gone yet. */
export const cancelCampaignAction = defineAction("messages.cancel_campaign", z.object({ id }), async (v, ctx) =>
  done(unwrap(await ctx.supabase.rpc("campaign_cancel_waiting", { p_id: v.id }), "cancel") as number),
);
