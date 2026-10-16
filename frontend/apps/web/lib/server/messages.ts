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

export interface CampaignRow {
  id: string;
  number: string;
  template_code: string;
  audience: { kind: string; min_days?: number; period?: string; text?: string };
  recipients: number;
  status: "draft" | "approved" | "rejected" | "cancelled";
  note: string | null;
  created_at: string;
  created_by: string | null;
  decision_note: string | null;
  district: { name_so: string; name_en: string } | null;
}

export async function listCampaigns() {
  const supabase = await createClient();
  return unwrap(
    await supabase
      .from("message_campaigns")
      .select("id, number, template_code, audience, recipients, status, note, created_at, created_by, decision_note, district:districts(name_so, name_en)")
      .order("created_at", { ascending: false })
      .limit(100),
    "campaigns",
  ) as unknown as CampaignRow[];
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
