import "server-only";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "./action";

export interface CitizenApplication {
  id: string;
  number: string;
  type: string;
  status: string;
  channel: string;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  district: { name_so: string; name_en: string } | null;
  pun: string | null;
  events: { action: string; to: string | null; at: string }[];
}

export async function citizenApplications(): Promise<CitizenApplication[]> {
  const supabase = await createClient();
  await supabase.rpc("my_party");
  return unwrap(await supabase.rpc("citizen_applications"), "applications") as CitizenApplication[];
}
