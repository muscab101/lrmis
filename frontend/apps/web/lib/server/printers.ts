import "server-only";
import { unwrap } from "@/lib/server/action";
import { createClient } from "@/lib/supabase/server";

export interface PrinterRow {
  id: string;
  code: string;
  name: string;
  manufacturer: string;
  model: string;
  serial_no: string;
  mac_address: string | null;
  ip_address: string | null;
  connection_type: "usb" | "ethernet" | "wifi";
  system_name: string;
  location: string;
  department: string | null;
  district_id: string | null;
  /** The point of sale (office or cash desk) the printer belongs to. */
  pos_id: string | null;
  pos_name: string | null;
  active: boolean;
  agent_last_seen: string | null;
  agent_ip: string | null;
  has_key: boolean;
}

export interface PrinterAlert {
  id: string;
  kind: "bad_key" | "inactive_printer_used" | "agent_moved" | "network_changed" | "printer_missing";
  detail: Record<string, string | null>;
  at: string;
  printer_code: string | null;
  printer_name: string | null;
}

export interface PrinterJob {
  id: string;
  status: "queued" | "printing" | "printed" | "failed";
  error: string | null;
  requested_at: string;
  finished_at: string | null;
  serial: string;
  printer_code: string;
  printer_name: string;
}

export async function printerOverview() {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("printer_overview"), "printers") as {
    printers: PrinterRow[];
    documents_printed: number;
    pending: number;
    failed: number;
    alerts: PrinterAlert[];
    jobs: PrinterJob[];
  };
}

export interface PrinterChoice {
  id: string;
  code: string;
  name: string;
  location: string;
  online: boolean;
  /** Its point of sale, and whether that is this person's own. */
  pos_name: string | null;
  mine: boolean;
}

/** The printers this person may send documents to. */
export async function printerChoices() {
  const supabase = await createClient();
  return unwrap(await supabase.rpc("printer_choices"), "printer choices") as PrinterChoice[];
}

/** Points of sale a printer can be assigned to (offices and cash desks, not online payments). */
export async function printerPointsOfSale() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("points_of_sale")
    .select("id, code, name")
    .eq("active", true)
    .neq("kind", "online")
    .order("name");
  return (data ?? []) as { id: string; code: string; name: string }[];
}
