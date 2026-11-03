import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";
import { normalizePun } from "@/lib/pun";
import type { ParcelStatus } from "./parcels";

export type RunStatus = "draft" | "submitted" | "approved" | "generating" | "issued" | "cancelled";
export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled";

export interface RunPreview {
  parcels?: number;
  count?: number;
  total?: number;
  exceptions?: { already_invoiced: number; not_registered_yet?: number; no_assessment: number; zero_amount: number };
  at?: string;
}

export interface RunRow {
  id: string;
  number: string;
  year: number;
  period: string;
  status: RunStatus;
  district_ids: string[];
  section_ids: string[];
  sector_ids: string[];
  neighbourhood_ids: string[];
  automatic: boolean;
  due_date: string;
  issue_date: string;
  preview: RunPreview;
  invoice_count: number;
  total: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  approved_by: string | null;
  cancel_reason: string | null;
  fee_type: { code: string; name_so: string; name_en: string } | null;
}

const RUN_COLUMNS =
  "id, number, year, period, status, district_ids, section_ids, sector_ids, neighbourhood_ids, automatic, due_date, issue_date, preview, invoice_count, total, note, created_at, created_by, approved_by, cancel_reason, fee_type:fee_types(code, name_so, name_en)";

export async function listRuns() {
  const supabase = await createClient();
  return unwrap(
    await supabase
      .from("billing_runs")
      .select(RUN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100),
    "runs",
  ) as unknown as RunRow[];
}

export async function getRun(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  return unwrap(
    await supabase.from("billing_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle(),
    "run",
  ) as unknown as RunRow | null;
}

export interface InvoiceRow {
  id: string;
  number: string;
  period: string;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  status: InvoiceStatus;
  parcel: { id: string; pun: string | null } | null;
  fee_type: { code: string; name_so: string; name_en: string } | null;
}


/** A row of the Invoices table: the invoice plus the land's account and receipt numbers and the owner's phone. */
export interface InvoiceListRow extends InvoiceRow {
  created_at: string;
  account_no: string | null;
  phone: string | null;
  /** Its land isn't registered yet, so it can't be paid. */
  partial_land: boolean;
  /** Its land is demolished: an archive, so it can't be paid. */
  demolished_land: boolean;
}
const LIST_COLUMNS =
  "id, number, period, issue_date, due_date, total, paid, credited, balance, status, created_at, fee_type:fee_types(code, name_so, name_en), " +
  "parcel:parcels(id, pun, status, building_state, account_no, owners:parcel_owners(valid_to, party:parties(phone)))";
export const INVOICE_SORTS = ["number", "issue_date", "due_date", "total", "paid"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];
export type InvoiceFilter = "open" | "overdue" | "paid" | "cancelled" | "any";

export const INVOICE_LANDS = ["registered", "partial", "demolished"] as const;
export type InvoiceLand = (typeof INVOICE_LANDS)[number];

/** How many bills, and what is still owed, for registered land, land in partial registration and demolished land. */
export async function invoicesByLand() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoices_by_land");
  const rows = (data ?? []) as { land: InvoiceLand; invoices: number; owed: number }[];
  const of = (land: InvoiceLand) => {
    const r = rows.find((x) => x.land === land);
    return { invoices: Number(r?.invoices ?? 0), owed: Number(r?.owed ?? 0) };
  };
  return { registered: of("registered"), partial: of("partial"), demolished: of("demolished") };
}

export async function listInvoices(opts: {
  filter: InvoiceFilter;
  q: string;
  runId?: string;
  parcelId?: string;
  page?: number;
  pageSize?: number;
  sort?: InvoiceSort;
  dir?: "asc" | "desc";
  from?: string;
  to?: string;
  feeCode?: string;
  /** Only the bills of registered land, or of land still in partial registration. */
  land?: InvoiceLand;
}) {
  const supabase = await createClient();
  let req = supabase.from("invoices").select(opts.land ? LIST_COLUMNS.replace("parcel:parcels(", "parcel:parcels!inner(") : LIST_COLUMNS, { count: "exact" });
  if (opts.land === "partial") req = req.in("parcel.status", ["draft", "surveyed", "verified"]).eq("parcel.building_state", "standing");
  if (opts.land === "registered") req = req.not("parcel.status", "in", "(draft,surveyed,verified)").eq("parcel.building_state", "standing");
  if (opts.land === "demolished") req = req.eq("parcel.building_state", "demolished");
  if (opts.from) req = req.gte("issue_date", opts.from);
  if (opts.to) req = req.lte("issue_date", opts.to);
  if (opts.feeCode) {
    const { data: fee } = await supabase
      .from("fee_types")
      .select("id")
      .eq("code", opts.feeCode)
      .maybeSingle();
    req = req.eq(
      "fee_type_id",
      (fee as { id: string } | null)?.id ?? "00000000-0000-0000-0000-000000000000",
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  if (opts.filter === "open") req = req.in("status", ["issued", "partially_paid"]);
  else if (opts.filter === "overdue")
    req = req.in("status", ["issued", "partially_paid"]).lt("due_date", today);
  else if (opts.filter !== "any") req = req.eq("status", opts.filter);
  if (opts.runId) req = req.eq("run_id", opts.runId);
  if (opts.parcelId) req = req.eq("parcel_id", opts.parcelId);
  const term = opts.q.replace(/[,()*%\\]/g, " ").trim();
  if (term) {
    if (/^(inv|scin)/i.test(term)) req = req.ilike("number", `%${term}%`);
    else {
      // PUN or account number of the land, or the owner's phone.
      const like = `%${normalizePun(term)}%`;
      const { data } = await supabase
        .from("parcels")
        .select("id")
        .or(`pun.ilike.${like},account_no.ilike.${like}`)
        .limit(200);
      const { data: byPhone } = /^\+?\d{5,}$/.test(term)
        ? await supabase
            .from("parcel_owners")
            .select("parcel_id, party:parties!inner(phone)")
            .is("valid_to", null)
            .ilike("party.phone", `%${term.replace(/^\+/, "")}%`)
            .limit(200)
        : { data: [] };
      const ids = [
        ...new Set([
          ...((data ?? []) as { id: string }[]).map((p) => p.id),
          ...((byPhone ?? []) as { parcel_id: string }[]).map((o) => o.parcel_id),
        ]),
      ];
      req = req.in("parcel_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
  }
  const page = opts.page ?? 1;
  const size = opts.pageSize ?? 50;
  const asc = opts.dir === "asc";
  // By default (and when sorting by number) a tax bill and its service charge stay together: INV before SCIN.
  if (!opts.sort || opts.sort === "number")
    req = req.order("number_key", { ascending: asc }).order("number", { ascending: true });
  else
    req = req
      .order(opts.sort, { ascending: asc })
      .order("number_key", { ascending: false })
      .order("number", { ascending: true });
  const res = await req.range((page - 1) * size, page * size - 1);
  return { rows: unwrap(res, "invoices") as unknown as InvoiceRow[], total: res.count ?? 0 };
}

/** Rows for the Invoices table: listInvoices plus the land's numbers and the current owner's phone. */
export async function listInvoiceTable(opts: Parameters<typeof listInvoices>[0]) {
  const { rows, total } = await listInvoices(opts);
  type Raw = InvoiceRow & {
    created_at: string;
    parcel:
      | (InvoiceRow["parcel"] & {
          status: string;
          building_state: string;
          account_no: string | null;
          owners?: { valid_to: string | null; party: { phone: string | null } | null }[];
        })
      | null;
  };
  return {
    total,
    rows: (rows as Raw[]).map((r): InvoiceListRow => ({
      ...r,
      parcel: r.parcel ? { id: r.parcel.id, pun: r.parcel.pun } : null,
      partial_land: ["draft", "surveyed", "verified"].includes(r.parcel?.status ?? ""),
      demolished_land: r.parcel?.building_state === "demolished",
      account_no: r.parcel?.account_no ?? null,
      phone: r.parcel?.owners?.find((o) => !o.valid_to && o.party?.phone)?.party?.phone ?? null,
    })),
  };
}

export interface InvoiceOwner {
  role: string;
  share_pct: number | null;
  valid_to: string | null;
  party: {
    id: string;
    full_name: string;
    mother_name: string | null;
    phone: string | null;
    email: string | null;
    id_type: string | null;
    id_number: string | null;
    owner_type: { name_so: string; name_en: string } | null;
  } | null;
}

export interface InvoiceDetail extends InvoiceRow {
  district_id: string;
  run_id: string | null;
  discount_until: string | null;
  early_discount_pct: number;
  currency: string;
  note: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  penalty_applied_at: string | null;
  parcel: {
    id: string;
    pun: string | null;
    status: ParcelStatus;
    building_state: "standing" | "demolished";
    account_no: string | null;
    area_m2: number | null;
    land_use: string;
    house_no: string | null;
    unit_no: string | null;
    parent_id: string | null;
    plot_width_m: number | null;
    plot_length_m: number | null;
    property_type: string | null;
    neighbourhood: { name_so: string; name_en: string } | null;
    district: { name_so: string; name_en: string } | null;
    owners: InvoiceOwner[];
  } | null;
  /** The property type's name, for the parcel card. */
  property_type_name: { name_so: string; name_en: string } | null;
  invoice_lines: {
    id: string;
    kind: string;
    description: string;
    amount: number;
    created_at: string;
  }[];
  credit_notes: {
    id: string;
    number: string;
    amount: number;
    reason: string;
    status: "pending" | "approved" | "rejected";
    requested_by: string | null;
    requested_at: string;
    decision_note: string | null;
  }[];
  run: { id: string; number: string } | null;
}

export async function getInvoice(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const res = await supabase
    .from("invoices")
    .select(
      `id, number, period, issue_date, due_date, total, paid, credited, balance, status, district_id, run_id, discount_until, early_discount_pct, currency, note, cancel_reason, created_by, penalty_applied_at,
       fee_type:fee_types(code, name_so, name_en),
       parcel:parcels(id, pun, status, building_state, account_no, area_m2, land_use, house_no, unit_no, parent_id, plot_width_m, plot_length_m, property_type, neighbourhood:neighbourhoods(name_so, name_en), district:districts(name_so, name_en),
         owners:parcel_owners(role, share_pct, valid_to, party:parties(id, full_name, mother_name, phone, email, id_type, id_number, owner_type:owner_types(name_so, name_en)))),
       invoice_lines(id, kind, description, amount, created_at),
       credit_notes(id, number, amount, reason, status, requested_by, requested_at, decision_note),
       run:billing_runs(id, number)`,
    )
    .eq("id", id)
    .maybeSingle();
  const inv = unwrap(res, "invoice") as unknown as InvoiceDetail | null;
  if (inv) {
    inv.invoice_lines.sort((a, b) => a.created_at.localeCompare(b.created_at));
    inv.property_type_name = null;
    if (inv.parcel) {
      inv.parcel.owners = inv.parcel.owners.filter((o) => !o.valid_to && o.party);
      if (inv.parcel.property_type) {
        const { data } = await supabase.from("property_grades").select("name_so, name_en").eq("code", inv.parcel.property_type).maybeSingle();
        inv.property_type_name = data as InvoiceDetail["property_type_name"];
      }
    }
  }
  return inv;
}

export async function getPayLink(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoice_pay_link", { p_id: id });
  return (data as string | null) ?? null;
}

export async function parcelOwnersFor(parcelId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parcel_owners")
    .select("share_pct, party:parties(full_name, phone)")
    .eq("parcel_id", parcelId)
    .is("valid_to", null);
  return (data ?? []) as unknown as {
    share_pct: number | null;
    party: { full_name: string; phone: string | null } | null;
  }[];
}

export async function billingCounts() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("billing_counts");
  return (data ?? {
    runs_waiting: 0,
    invoices_open: 0,
    invoices_overdue: 0,
    outstanding: 0,
    credit_notes_pending: 0,
    plans_pending: 0,
  }) as {
    runs_waiting: number;
    invoices_open: number;
    invoices_overdue: number;
    outstanding: number;
    credit_notes_pending: number;
    plans_pending: number;
  };
}

export async function recurringFeeTypes() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fee_types")
    .select("id, code, name_so, name_en, interval, amount")
    .eq("active", true)
    .order("sort");
  return (data ?? []) as {
    id: string;
    code: string;
    name_so: string;
    name_en: string;
    interval: string;
    amount: number;
  }[];
}

/** One batch of a run: the land of one neighbourhood, with what is billed and what is skipped. */
export interface RunBatch {
  neighbourhood_id: string | null;
  neighbourhood_code: string | null;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  section_so: string | null;
  section_en: string | null;
  district_so: string | null;
  district_en: string | null;
  bills: number;
  total: number;
  skipped: number;
  district_id: string | null;
  section_id: string | null;
  section_code: string | null;
  sector_id: string | null;
  sector_code: string | null;
  sector_so: string | null;
  sector_en: string | null;
}

const isId = (v: string | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** The choices for a place filter: every district, and the places under whichever level is chosen. */
export async function placeChoices(q: { d?: string; s?: string; k?: string }, lang: string) {
  const supabase = await createClient();
  type Row = { id: string; code?: string | null; name_so: string; name_en: string };
  const options = (rows: unknown) =>
    ((rows ?? []) as Row[]).map((r) => {
      const name = lang === "so" ? r.name_so : r.name_en;
      return { id: r.id, label: r.code && r.code !== name ? `${r.code} · ${name}` : name };
    });
  const none = { data: [] };
  const [districts, sections, sectors, neighbourhoods] = await Promise.all([
    supabase.from("districts").select("id, name_so, name_en").is("deleted_at", null).order("name_en"),
    isId(q.d) ? supabase.from("sections").select("id, code, name_so, name_en").eq("district_id", q.d!).order("code") : none,
    isId(q.s) ? supabase.from("sectors").select("id, code, name_so, name_en").eq("section_id", q.s!).order("code") : none,
    isId(q.k) ? supabase.from("neighbourhoods").select("id, code, name_so, name_en").eq("sector_id", q.k!).is("deleted_at", null).order("code") : none,
  ]);
  return { d: options(districts.data), s: options(sections.data), k: options(sectors.data), n: options(neighbourhoods.data) };
}

export async function runBatches(runId: string) {
  const supabase = await createClient();
  return (unwrap(await supabase.rpc("billing_run_batches", { p_id: runId }), "run batches") as RunBatch[]).map((b) => ({ ...b, total: Number(b.total) }));
}

export interface BatchBill {
  parcel_id: string;
  pun: string | null;
  house_no: string | null;
  owner: string | null;
  amount: number | null;
  exception: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
}

export async function runBatchBills(runId: string, neighbourhoodId: string | null) {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("billing_run_batch_bills", { p_id: runId, p_neighbourhood: neighbourhoodId }), "batch bills") as BatchBill[];
}

/** Names of the places a run was limited to. */
export async function runPlaceNames(run: Pick<RunRow, "section_ids" | "sector_ids" | "neighbourhood_ids">, lang: string) {
  const supabase = await createClient();
  const names = async (table: "sections" | "sectors" | "neighbourhoods", ids: string[]) => {
    if (!ids.length) return [];
    const { data } = await supabase.from(table).select("code, name_so, name_en").in("id", ids);
    return ((data ?? []) as { code: string; name_so: string; name_en: string }[]).map((x) => (lang === "so" ? x.name_so : x.name_en) || x.code);
  };
  const [sections, sectors, neighbourhoods] = await Promise.all([names("sections", run.section_ids), names("sectors", run.sector_ids), names("neighbourhoods", run.neighbourhood_ids)]);
  return [...sections, ...sectors, ...neighbourhoods];
}
