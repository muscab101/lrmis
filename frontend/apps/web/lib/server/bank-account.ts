import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface BankAccount {
  bank: string;
  account_name: string;
  account_no: string;
  branch: string;
  swift: string;
}

/** The city's bank account for transfers (set on Payments → Providers); null until an account number is set. */
export async function bankAccount(): Promise<BankAccount | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "payments.bank_account").maybeSingle();
  const v = (data?.value ?? null) as Partial<BankAccount> | null;
  if (!v?.account_no?.trim()) return null;
  return { bank: v.bank ?? "", account_name: v.account_name ?? "", account_no: v.account_no, branch: v.branch ?? "", swift: v.swift ?? "" };
}

/** The same, for the staff form (empty fields until set). */
export async function bankAccountForEdit(): Promise<BankAccount> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("value").eq("key", "payments.bank_account").maybeSingle();
  const v = (data?.value ?? {}) as Partial<BankAccount>;
  return { bank: v.bank ?? "", account_name: v.account_name ?? "", account_no: v.account_no ?? "", branch: v.branch ?? "", swift: v.swift ?? "" };
}
