import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

/** Every kind of thing that waits for an approval, and the part of the system it belongs to. */
export const APPROVAL_KINDS = {
  transfer: "transfers",
  certificate_issue: "certificates",
  reprint: "certificates",
  credit_note: "accounting",
  payment_plan: "accounting",
  billing_run: "accounting",
  payment_correction: "accounting",
  reversal: "accounting",
  shift: "accounting",
  commission_payout: "accounting",
  commission_rule: "accounting",
  cashier_recon: "accounting",
  recon_batch: "accounting",
  pos_payments: "accounting",
  payment: "accounting",
  movement: "accounting",
} as const;
export type ApprovalKind = keyof typeof APPROVAL_KINDS;
/** The parts on the Applications page: transfers, certificates and accounting (other approvals stay on their own pages). */
export const APPROVAL_GROUPS = ["transfers", "certificates", "accounting"] as const;
export type ApprovalGroup = (typeof APPROVAL_GROUPS)[number];
type AnyGroup = (typeof APPROVAL_KINDS)[ApprovalKind];

/** Kinds that are only approved here (turning them down happens on their own page). */
export const APPROVE_ONLY: readonly ApprovalKind[] = ["certificate_issue", "shift", "billing_run", "commission_rule", "pos_payments", "payment"];
/** Kinds decided on their own page (none: everything is approved on Applications). */
export const OPEN_ONLY: readonly ApprovalKind[] = [];

/** Kinds the person who made them can never approve (a second person must): their own show no Approve button. */
export const SECOND_PERSON: readonly ApprovalKind[] = [
  "billing_run",
  "cashier_recon",
  "commission_payout",
  "commission_rule",
  "credit_note",
  "payment_correction",
  "payment_plan",
  "recon_batch",
  "reprint",
  "reversal",
  "shift",
];

/** The powers that let someone approve something: anyone with one of them has an Applications page. */
export const APPROVAL_PERMISSIONS = [
  "transfers.approve",
  "certificates.approve",
  "invoices.approve",
  "billing.approve",
  "payments.approve",
  "reconciliation.approve",
  "reconciliation.update",
  "accounting.approve",
] as const;

export interface ApprovalItem {
  kind: ApprovalKind;
  id: string;
  ref: string | null;
  title: string | null;
  detail: string | null;
  amount: number | null;
  by: string | null;
  at: string | null;
  href: string;
  /** This person asked for it: someone else approves. */
  mine: boolean | null;
  /** The district it belongs to (none for work that covers several). */
  district: { code: string; name_so: string; name_en: string } | null;
  /** More to decide on: keys ending in _usd are money, _date are dates, the rest plain. */
  facts: Record<string, string | number> | null;
  /** What some kinds need to be approved (desk payments: the cashier and the days). */
  extra?: Record<string, string> | null;
}

/** Everything waiting for this person's approval (only the kinds they may approve, in their districts). */
export async function listApprovals() {
  const supabase = await createClient();
  const out = unwrap(await supabase.rpc("approvals_inbox"), "approvals") as { items: ApprovalItem[] };
  return out.items.filter((i) => i.kind in APPROVAL_KINDS && (APPROVAL_GROUPS as readonly AnyGroup[]).includes(APPROVAL_KINDS[i.kind]));
}

/** Whether this Super Admin is on the short list allowed to approve their own work (security.self_approve_users). */
export async function canApproveOwn(userId: string, isSuperAdmin: boolean) {
  if (!isSuperAdmin) return false;
  const admin = await createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", "security.self_approve_users").maybeSingle();
  const list = (data as { value: unknown } | null)?.value;
  return Array.isArray(list) && list.includes(userId);
}
