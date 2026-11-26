import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export type MessageStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";

export interface MessageRow {
  id: string;
  to_address: string;
  body: string;
  template_code: string | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  related_kind: string | null;
  party: { id: string; full_name: string } | null;
}

export async function listMessages(status: MessageStatus | "any", q: string, page: number) {
  const supabase = await createClient();
  let req = supabase
    .from("messages")
    .select("id, to_address, body, template_code, status, attempts, last_error, created_at, sent_at, related_kind, party:parties(id, full_name)", { count: "exact" });
  if (status !== "any") req = req.eq("status", status);
  if (/^\+?\d{4,15}$/.test(q)) req = req.like("to_address", `%${q.replace(/^\+/, "")}%`);
  const res = await req.order("created_at", { ascending: false }).range((page - 1) * 50, page * 50 - 1);
  return { rows: unwrap(res, "messages") as unknown as MessageRow[], total: res.count ?? 0 };
}

export async function messageCounts() {
  const supabase = await createClient();
  const count = async (s: MessageStatus) => (await supabase.from("messages").select("id", { count: "exact", head: true }).eq("status", s)).count ?? 0;
  const [queued, failed, sent, drafts] = await Promise.all([
    count("queued"),
    count("failed"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", new Date(Date.now() - 864e5).toISOString()),
    supabase.from("message_campaigns").select("id", { count: "exact", head: true }).eq("status", "draft"),
  ]);
  return { queued, failed, sent_today: sent.count ?? 0, campaigns_draft: drafts.count ?? 0 };
}

export interface TemplateRow {
  code: string;
  body_so: string;
  body_en: string;
  description: string;
  is_system: boolean;
  active: boolean;
  updated_at: string;
}

export async function listTemplates() {
  const supabase = await createClient();
  return unwrap(await supabase.from("message_templates").select("code, body_so, body_en, description, is_system, active, updated_at").order("is_system", { ascending: false }).order("code"), "templates") as TemplateRow[];
}

export interface SystemWarning {
  id: string;
  message: string;
  created_at: string;
  sender: string | null;
  /** The district it went to, or null for every district. */
  district: { name_so: string; name_en: string } | null;
}

/** The last warnings sent to every screen, newest first, with who sent them. */
export async function listWarnings(limit = 10): Promise<SystemWarning[]> {
  const supabase = await createClient();
  const rows = (unwrap(
    await supabase
      .from("system_warnings")
      .select("id, message, created_at, created_by, district:districts(name_so, name_en)")
      .order("created_at", { ascending: false })
      .limit(limit),
    "warnings",
  ) ?? []) as unknown as {
    id: string;
    message: string;
    created_at: string;
    created_by: string;
    district: { name_so: string; name_en: string } | null;
  }[];
  const ids = [...new Set(rows.map((r) => r.created_by))];
  const names = ids.length
    ? (((await supabase.from("profiles").select("user_id, full_name").in("user_id", ids)).data ?? []) as {
        user_id: string;
        full_name: string;
      }[])
    : [];
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    created_at: r.created_at,
    sender: names.find((n) => n.user_id === r.created_by)?.full_name ?? null,
    district: r.district,
  }));
}

/** What a message is about (the categories on Compose). */
export const MESSAGE_CATEGORIES = ["tax_reminder", "tax_invoice", "payment_confirmation", "outstanding_tax", "general", "government", "custom"] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];
/** Where a campaign stands: worked out from its messages. */
export const CAMPAIGN_STATES = ["scheduled", "sending", "sent", "partial", "failed", "cancelled", "draft", "rejected"] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export interface CampaignArea {
  level: "district" | "section" | "sector" | "neighbourhood";
  code: string;
  name_so: string;
  name_en: string;
}

export interface CampaignSummary {
  id: string;
  number: string;
  kind: "template" | "compose";
  title: string | null;
  category: MessageCategory | null;
  lang: "so" | "en" | null;
  body: string | null;
  template_code: string | null;
  audience: { kind: string; min_days?: number; period?: string; text?: string } | null;
  areas: CampaignArea[] | null;
  target: { owners?: string[]; all?: boolean } | null;
  district: { name_so: string; name_en: string } | null;
  note: string | null;
  decision_note: string | null;
  status: "draft" | "approved" | "rejected" | "cancelled";
  created_at: string;
  created_by: string | null;
  scheduled_at: string | null;
  sender: string | null;
  recipients: number;
  total: number;
  sent: number;
  failed: number;
  waiting: number;
  cancelled: number;
  state: CampaignState;
  channel?: "sms" | "whatsapp" | "email";
  per_parcel?: boolean;
}

export interface CampaignFilters {
  q?: string;
  state?: CampaignState;
  category?: MessageCategory;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
  id?: string;
}

/** Message history: every campaign the user may see, newest first, with its delivery counts. */
export async function listCampaignHistory(f: CampaignFilters) {
  const supabase = await createClient();
  const p = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ""));
  const out = unwrap(await supabase.rpc("campaign_list", { p }), "campaigns") as { total: number; rows: CampaignSummary[] };
  return { total: Number(out.total) || 0, rows: out.rows ?? [] };
}

export async function getCampaign(id: string): Promise<CampaignSummary | null> {
  const { rows } = await listCampaignHistory({ id });
  return rows[0] ?? null;
}

/** The messages of one campaign (one per owner), 50 a page. */
export async function campaignMessages(id: string, status: MessageStatus | "any", page: number, size = 50) {
  const supabase = await createClient();
  let req = supabase
    .from("messages")
    .select("id, to_address, body, template_code, status, attempts, last_error, created_at, sent_at, related_kind, party:parties(id, full_name)", { count: "exact" })
    .eq("campaign_id", id);
  if (status !== "any") req = req.eq("status", status);
  const res = await req.order("status").order("created_at").range((page - 1) * size, page * size - 1);
  return { rows: unwrap(res, "messages") as unknown as MessageRow[], total: res.count ?? 0 };
}

/** The templates written for Compose (with placeholders like {owner_name}). */
export async function composeTemplates() {
  const supabase = await createClient();
  return unwrap(
    await supabase.from("message_templates").select("code, body_so, body_en, category").not("category", "is", null).eq("active", true).order("code"),
    "templates",
  ) as { code: string; body_so: string; body_en: string; category: MessageCategory }[];
}

export interface UserArea {
  level: "section" | "sector" | "neighbourhood";
  id: string;
  code: string;
  name_so: string;
  name_en: string;
}

/** The sections, sectors or neighbourhoods a user is limited to for messages (none = their whole districts). */
export async function userAreas(userId: string) {
  const supabase = await createClient();
  return (unwrap(await supabase.rpc("user_areas_of", { p_user_id: userId }), "areas") ?? []) as UserArea[];
}
