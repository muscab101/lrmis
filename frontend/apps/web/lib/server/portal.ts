import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

type Named = { name_so: string; name_en: string } | null;

export interface CitizenParcel {
  id: string;
  pun: string | null;
  status: string;
  /** The parcel is still in partial registration, or the owner is still a draft: no paying, visit the district. */
  partial: boolean;
  demolished: boolean;
  land_use: string;
  area_m2: number | null;
  house_no: string | null;
  /** When the next yearly tax bill comes (the property's anniversary). */
  next_bill: string | null;
  district: Named;
  neighbourhood: Named;
  share: number | null;
  balance: number;
  overdue: number;
  invoices: { id: string; number: string; period: string; due_date: string; total: number; balance: number; status: string; fee_so: string; fee_en: string; token: string | null }[];
  documents: { id: string; type: "certificate" | "id_card"; serial: string; status: string; verify_code: string; issued_at: string; expires_at: string | null }[];
  geom: GeoJSON.Polygon | null;
}

export interface CitizenOverview {
  parcels: CitizenParcel[];
  messages: { id: string; body: string; status: string; created_at: string }[];
  payments: { id: string; receipt_no: string; amount: number; received_at: string; pun: string | null; method: string }[];
}

/** Everything linked to the signed-in citizen (owned parcels, bills with pay links, documents, receipts, SMS). */
export async function citizenOverview(): Promise<CitizenOverview> {
  const supabase = await createClient();
  // Links the account to the owner already on the register with the same phone (first visit).
  await supabase.rpc("my_party");
  return unwrap(await supabase.rpc("citizen_overview"), "overview") as CitizenOverview;
}

export interface CitizenMe {
  id: string;
  full_name: string;
  mother_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  id_type: string | null;
  id_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  registered_at: string | null;
  district: Named;
}

/** The signed-in citizen's own record on the register (their name, ID, phone, …), when linked. */
export async function citizenMe(): Promise<CitizenMe | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("parties")
    .select("id, full_name, mother_name, gender, date_of_birth, id_type, id_number, phone, email, address, registered_at, district:districts(name_so, name_en)")
    .eq("citizen_user_id", auth.user.id)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data as unknown as CitizenMe | null) ?? null;
}

export interface CitizenReceipt {
  id: string;
  receipt_no: string;
  amount: number;
  currency: string;
  unallocated: number;
  method: string;
  reference: string | null;
  payer_name: string | null;
  status: string;
  received_at: string;
  parcel: { id: string; pun: string | null } | null;
  pos: { name: string } | null;
  payment_allocations: { id: number; amount: number; invoice: { number: string; period: string | null } | null }[];
  /** The cashier who took it (null when paid online). */
  created_by: string | null;
}

/** One of the citizen's own receipts (the database only shows payments on land they own). */
export async function citizenReceipt(id: string): Promise<CitizenReceipt | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("id, receipt_no, amount, currency, unallocated, method, reference, payer_name, status, received_at, created_by, parcel:parcels(id, pun), pos:points_of_sale(name), payment_allocations(id, amount, invoice:invoices(number, period))")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as CitizenReceipt | null) ?? null;
}
