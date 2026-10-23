import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface CollectBill {
  invoice_id: string;
  invoice_number: string;
  fee_name_so: string;
  fee_name_en: string;
  total: number;
  balance: number;
  due_date: string;
  pay_path: string | null;
}

export interface CollectHouse {
  parcel_id: string;
  pun: string;
  house_no: string | null;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  district_so: string;
  district_en: string;
  owners: string | null;
  due: number;
  bills: CollectBill[];
}

/** Registered houses in the cashier's districts that still owe money, with their unpaid bills. */
export async function housesToCollect(): Promise<CollectHouse[]> {
  const supabase = await createClient();
  const rows = unwrap(await supabase.rpc("cashier_to_collect", {}), "to collect") as (CollectBill & Omit<CollectHouse, "due" | "bills">)[];
  const houses = new Map<string, CollectHouse>();
  for (const r of rows) {
    const h =
      houses.get(r.parcel_id) ??
      houses
        .set(r.parcel_id, {
          parcel_id: r.parcel_id,
          pun: r.pun,
          house_no: r.house_no,
          neighbourhood_so: r.neighbourhood_so,
          neighbourhood_en: r.neighbourhood_en,
          district_so: r.district_so,
          district_en: r.district_en,
          owners: r.owners,
          due: 0,
          bills: [],
        })
        .get(r.parcel_id)!;
    h.due += Number(r.balance);
    h.bills.push({
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_number,
      fee_name_so: r.fee_name_so,
      fee_name_en: r.fee_name_en,
      total: Number(r.total),
      balance: Number(r.balance),
      due_date: r.due_date,
      pay_path: r.pay_path,
    });
  }
  return [...houses.values()];
}
