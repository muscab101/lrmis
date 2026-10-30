import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export type RequestStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
type OwnerEntry = { party_id: string; full_name: string; role: string; share_pct: number | null };

export interface TransferRow {
  id: string;
  number: string;
  kind: "sale" | "gift" | "inheritance" | "court_order";
  status: RequestStatus;
  declared_value: number | null;
  from_owners: OwnerEntry[];
  to_owners: OwnerEntry[];
  created_at: string;
  created_by: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  note: string | null;
  parcel: { id: string; pun: string | null } | null;
  duty_invoice: { id: string; number: string; status: string; balance: number; total: number } | null;
}

const TRANSFER_COLS =
  "id, number, kind, status, declared_value, from_owners, to_owners, created_at, created_by, submitted_at, decided_at, decision_note, note, parcel:parcels(id, pun), duty_invoice:invoices!transfers_duty_invoice_id_fkey(id, number, status, balance, total)";

export async function listTransfers(status: RequestStatus | "open" | "any", parcelId?: string) {
  const supabase = await createClient();
  let req = supabase.from("transfers").select(TRANSFER_COLS);
  if (status === "open") req = req.in("status", ["draft", "submitted"]);
  else if (status !== "any") req = req.eq("status", status);
  if (parcelId) req = req.eq("parcel_id", parcelId);
  return unwrap(await req.order("created_at", { ascending: false }).limit(100), "transfers") as unknown as TransferRow[];
}

export async function getTransfer(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  return unwrap(await supabase.from("transfers").select(TRANSFER_COLS).eq("id", id).maybeSingle(), "transfer") as unknown as TransferRow | null;
}

export interface ParcelLegal {
  blockers: { transfer: string[]; subdivide: string[]; permit: string[] };
  disputes: { id: string; number: string; kind: string; description: string; claimant_name: string; status: string; opened_by: string | null; opened_at: string; resolution: string | null }[];
  orders: { id: string; order_no: string; court: string; order_date: string; kind: string; description: string; active: boolean; created_by: string | null }[];
  liens: { id: string; kind: string; holder: string; amount: number | null; reference: string | null; active: boolean; registered_by: string | null; registered_at: string }[];
  leases: { id: string; number: string; start_date: string; end_date: string; annual_rent: number; purpose: string | null; status: string; lessee: { full_name: string } | null }[];
  changes: { id: string; number: string; kind: string; status: string; reason: string; requested_by: string | null; requested_at: string; result_parcel_ids: string[] }[];
  permits: { id: string; number: string; kind: string; status: string; description: string; valid_until: string | null }[];
  transfers: TransferRow[];
}

export async function parcelLegal(parcelId: string): Promise<ParcelLegal> {
  const supabase = await createClient();
  const [s, d, o, l, le, c, p, t] = await Promise.all([
    supabase.rpc("parcel_legal_status", { p_parcel: parcelId }),
    supabase.from("disputes").select("id, number, kind, description, claimant_name, status, opened_by, opened_at, resolution").eq("parcel_id", parcelId).order("opened_at", { ascending: false }),
    supabase.from("court_orders").select("id, order_no, court, order_date, kind, description, active, created_by").eq("parcel_id", parcelId).order("order_date", { ascending: false }),
    supabase.from("liens").select("id, kind, holder, amount, reference, active, registered_by, registered_at").eq("parcel_id", parcelId).order("registered_at", { ascending: false }),
    supabase.from("leases").select("id, number, start_date, end_date, annual_rent, purpose, status, lessee:parties(full_name)").eq("parcel_id", parcelId).order("start_date", { ascending: false }),
    supabase.from("parcel_changes").select("id, number, kind, status, reason, requested_by, requested_at, result_parcel_ids").contains("parcel_ids", [parcelId]).order("requested_at", { ascending: false }),
    supabase.from("permits").select("id, number, kind, status, description, valid_until").eq("parcel_id", parcelId).order("requested_at", { ascending: false }),
    listTransfers("any", parcelId),
  ]);
  return {
    blockers: (s.data as ParcelLegal["blockers"] | null) ?? { transfer: [], subdivide: [], permit: [] },
    disputes: (d.data ?? []) as ParcelLegal["disputes"],
    orders: (o.data ?? []) as ParcelLegal["orders"],
    liens: (l.data ?? []) as ParcelLegal["liens"],
    leases: (le.data ?? []) as unknown as ParcelLegal["leases"],
    changes: (c.data ?? []) as ParcelLegal["changes"],
    permits: (p.data ?? []) as ParcelLegal["permits"],
    transfers: t,
  };
}

export async function listDisputes(status: "open" | "any") {
  const supabase = await createClient();
  let req = supabase.from("disputes").select("id, number, kind, description, claimant_name, status, opened_by, opened_at, resolution, parcel:parcels(id, pun)");
  if (status === "open") req = req.eq("status", "open");
  return unwrap(await req.order("opened_at", { ascending: false }).limit(100), "disputes") as unknown as (ParcelLegal["disputes"][number] & { parcel: { id: string; pun: string | null } | null })[];
}

type WithParcel<T> = T & { parcel: { id: string; pun: string | null } | null };

export async function listActiveLiens() {
  const supabase = await createClient();
  const { data } = await supabase.from("liens").select("id, kind, holder, amount, reference, active, registered_by, registered_at, parcel:parcels(id, pun)").eq("active", true).order("registered_at", { ascending: false }).limit(100);
  return (data ?? []) as unknown as WithParcel<ParcelLegal["liens"][number]>[];
}

export async function listActiveOrders() {
  const supabase = await createClient();
  const { data } = await supabase.from("court_orders").select("id, order_no, court, order_date, kind, description, active, created_by, parcel:parcels(id, pun)").eq("active", true).order("order_date", { ascending: false }).limit(100);
  return (data ?? []) as unknown as WithParcel<ParcelLegal["orders"][number]>[];
}

/** Parcel changes, newest first; with a parcel, only those it was part of or came out of. */
export async function listChanges(status: "submitted" | "any", parcelId?: string) {
  const supabase = await createClient();
  let req = supabase.from("parcel_changes").select("id, number, kind, status, reason, payload, parcel_ids, requested_by, requested_at, decided_at, result_parcel_ids");
  if (status === "submitted") req = req.eq("status", "submitted");
  if (parcelId) req = req.or(`parcel_ids.cs.{${parcelId}},result_parcel_ids.cs.{${parcelId}}`);
  const rows = unwrap(await req.order("requested_at", { ascending: false }).limit(100), "changes") as { id: string; number: string; kind: string; status: string; reason: string; payload: { land_use?: string; children?: unknown[] } & Record<string, unknown>; parcel_ids: string[]; requested_by: string | null; requested_at: string; decided_at: string | null; result_parcel_ids: string[] }[];
  const ids = [...new Set(rows.flatMap((r) => [...r.parcel_ids, ...r.result_parcel_ids]))];
  const { data } = ids.length ? await supabase.from("parcels").select("id, pun").in("id", ids) : { data: [] };
  const pun = new Map(((data ?? []) as { id: string; pun: string | null }[]).map((p) => [p.id, p.pun]));
  return rows.map((r) => ({ ...r, puns: r.parcel_ids.map((i) => pun.get(i) ?? "?"), result_puns: r.result_parcel_ids.map((i) => pun.get(i) ?? "?") }));
}

export interface PermitRow {
  id: string;
  number: string;
  kind: string;
  status: RequestStatus;
  description: string;
  floors: number | null;
  area_m2: number | null;
  applicant_name: string;
  conditions: string | null;
  valid_until: string | null;
  requested_by: string | null;
  requested_at: string;
  decision_note: string | null;
  parcel: { id: string; pun: string | null } | null;
  fee_invoice: { id: string; number: string; status: string } | null;
}

export async function listPermits(status: RequestStatus | "any") {
  const supabase = await createClient();
  let req = supabase
    .from("permits")
    .select("id, number, kind, status, description, floors, area_m2, applicant_name, conditions, valid_until, requested_by, requested_at, decision_note, parcel:parcels(id, pun), fee_invoice:invoices!permits_fee_invoice_id_fkey(id, number, status)");
  if (status !== "any") req = req.eq("status", status);
  return unwrap(await req.order("requested_at", { ascending: false }).limit(100), "permits") as unknown as PermitRow[];
}

export async function legalCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("legal_counts");
  return (data ?? {}) as Record<"transfers_waiting" | "transfers_draft" | "disputes_open" | "liens_active" | "orders_active" | "changes_waiting" | "permits_waiting" | "leases_active", number>;
}
