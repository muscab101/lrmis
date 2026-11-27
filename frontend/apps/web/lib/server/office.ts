import "server-only";
import { cache } from "react";
import type { Office } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's office, or another user's (needs users.view). Read fresh on every page, so a change by an admin shows at once. */
export const userOffice = cache(async (userId: string | null = null): Promise<Office | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("user_office", { p_user_id: userId });
  return error ? null : ((data as Office | null) ?? null);
});
