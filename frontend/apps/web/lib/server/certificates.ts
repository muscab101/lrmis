import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface Snapshot {
  pun: string;
  account_no: string | null;
  area_m2: number | null;
  perimeter_m: number | null;
  land_use: string;
  ownership: string;
  plot_no: string | null;
  deed_no: string | null;
  /** Frozen from migration 0065 on; older documents fall back to the register (see watermarkLine). */
  house_no?: string | null;
  invoice_no?: string | null;
  registered_at: string | null;
  district: { code: string; name_so: string; name_en: string };
  neighbourhood: { code: string; name_so: string; name_en: string } | null;
  centroid: [number, number];
  geom: GeoJSON.Polygon;
  neighbours: { north?: string; east?: string; south?: string; west?: string };
  adjacent: { pun: string | null; geom: GeoJSON.Polygon }[];
  owners: { party_id: string; full_name: string; mother_name: string | null; id_type: string | null; id_number: string | null; role: string; share_pct: number | null; photo_path: string | null; phone?: string | null }[];
  holder?: Snapshot["owners"][number];
  registrar: string | null;
}

export interface DocumentRow {
  id: string;
  type: "certificate" | "id_card";
  serial: string;
  status: "valid" | "cancelled";
  issued_at: string;
  expires_at: string | null;
  print_count: number;
  parcel: { id: string; pun: string | null } | null;
  party: { full_name: string } | null;
}

const COLS = "id, type, serial, status, issued_at, expires_at, print_count, parcel:parcels(id, pun), party:parties(full_name)";

export async function listDocuments(opts: { q: string; status: "valid" | "any"; unprinted?: boolean }) {
  const supabase = await createClient();
  let req = supabase.from("issued_documents").select(COLS);
  if (opts.status === "valid") req = req.eq("status", "valid");
  if (opts.unprinted) req = req.eq("print_count", 0);
  const term = opts.q.replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    if (/^bn-/i.test(term)) {
      const { data } = await supabase.from("parcels").select("id").ilike("pun", `%${term}%`).limit(50);
      const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
      req = req.in("parcel_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    } else req = req.ilike("serial", `%${term}%`);
  }
  return unwrap(await req.order("issued_at", { ascending: false }).limit(100), "documents") as unknown as DocumentRow[];
}

export interface DocumentDetail extends DocumentRow {
  verify_code: string;
  snapshot: Snapshot;
  replaces_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  issued_by: string | null;
  print_jobs: { id: number; kind: string; printed_at: string; printed_by: string | null }[];
  reprint_requests: { id: string; kind: "reprint" | "correction"; reason: string; status: "pending" | "approved" | "rejected"; requested_by: string | null; requested_at: string; fee_invoice_id: string | null; decision_note: string | null; new_document_id: string | null }[];
}

export async function getDocument(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("issued_documents")
    .select(`${COLS}, verify_code, snapshot, replaces_id, cancel_reason, cancelled_at, issued_by, print_jobs(id, kind, printed_at, printed_by), reprint_requests!reprint_requests_document_id_fkey(id, kind, reason, status, requested_by, requested_at, fee_invoice_id, decision_note, new_document_id)`)
    .eq("id", id)
    .maybeSingle();
  return unwrap(res, "document") as unknown as DocumentDetail | null;
}

export interface ReprintRow {
  id: string;
  kind: "reprint" | "correction";
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  requested_at: string;
  fee_invoice: { id: string; number: string; status: string; balance: number } | null;
  document: { id: string; serial: string; type: string; parcel: { pun: string | null } | null } | null;
}

export async function listReprints(status: "pending" | "any") {
  const supabase = await createClient();
  let req = supabase
    .from("reprint_requests")
    .select("id, kind, reason, status, requested_by, requested_at, fee_invoice:invoices(id, number, status, balance), document:issued_documents!reprint_requests_document_id_fkey(id, serial, type, parcel:parcels(pun))");
  if (status === "pending") req = req.eq("status", "pending");
  return unwrap(await req.order("requested_at", { ascending: false }).limit(100), "reprints") as unknown as ReprintRow[];
}

export async function certificatesCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("certificates_counts");
  return (data ?? { valid_certificates: 0, unprinted: 0, reprints_pending: 0, registered_without: 0 }) as {
    valid_certificates: number;
    unprinted: number;
    reprints_pending: number;
    registered_without: number;
  };
}

/** Registered parcels without a valid certificate, with what (if anything) blocks one. */
export async function parcelsToCertify(limit = 30) {
  const supabase = await createClient();
  const { data: docs } = await supabase.from("issued_documents").select("parcel_id").eq("type", "certificate").eq("status", "valid");
  const done = new Set(((docs ?? []) as { parcel_id: string }[]).map((d) => d.parcel_id));
  const { data } = await supabase.from("parcels").select("id, pun, area_m2, registered_at").eq("status", "registered").order("registered_at", { ascending: false }).limit(200);
  const rows = ((data ?? []) as { id: string; pun: string; area_m2: number | null; registered_at: string | null }[]).filter((p) => !done.has(p.id)).slice(0, limit);
  return Promise.all(
    rows.map(async (p) => {
      const { data: e } = await supabase.rpc("certificate_eligibility", { p_parcel: p.id });
      return { ...p, blockers: ((e as { blockers: string[] } | null)?.blockers ?? []) as string[] };
    }),
  );
}

export async function parcelCertificate(parcelId: string) {
  const supabase = await createClient();
  const [{ data: e }, { data: docs }] = await Promise.all([
    supabase.rpc("certificate_eligibility", { p_parcel: parcelId }),
    supabase.from("issued_documents").select(COLS).eq("parcel_id", parcelId).order("issued_at", { ascending: false }),
  ]);
  return { blockers: ((e as { blockers: string[] } | null)?.blockers ?? []) as string[], documents: (docs ?? []) as unknown as DocumentRow[] };
}

export interface DocumentChange {
  field: "pun" | "area_m2" | "land_use" | "ownership" | "plot_no" | "deed_no" | "neighbourhood" | "owners";
  before: string | null;
  after: string | null;
}

/** What differs between the printed document and today's register (what a correction would change). */
export async function documentChanges(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("document_changes", { p_id: id });
  return (data ?? []) as DocumentChange[];
}

/**
 * The certificate's security watermark: issue date, owners and their phones, house number, tax bill,
 * neighbourhood and district on one line. Uses the frozen snapshot; documents issued before those
 * facts were frozen get them from today's register.
 */
export async function watermarkLine(doc: DocumentDetail, lang: string) {
  const s = doc.snapshot;
  const frozen = "invoice_no" in s;
  let facts = { house_no: s.house_no ?? null, invoice_no: s.invoice_no ?? null, phones: {} as Record<string, string> };
  if (!frozen) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("document_watermark_facts", { p_id: doc.id });
    if (data) facts = data as typeof facts;
  }
  const name = (o: { name_so: string; name_en: string } | null | undefined) => (o ? (lang === "so" ? o.name_so : o.name_en) : null);
  return [
    doc.issued_at.slice(0, 10),
    s.owners.map((o) => o.full_name).join(" / "),
    s.owners.map((o) => o.phone ?? facts.phones[o.party_id]).filter(Boolean).join(" / "),
    facts.house_no,
    facts.invoice_no,
    name(s.neighbourhood),
    name(s.district),
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
}
