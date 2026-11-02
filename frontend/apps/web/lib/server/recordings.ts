import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "./log";

export const RECORDINGS_BUCKET = "staff-recordings";

/** Removes recordings past the 30 days: the files first, then their rows. */
export async function removeExpiredRecordings() {
  try {
    const admin = await createAdminClient();
    const { data } = await admin.rpc("recording_expired", { p_limit: 500 });
    const paths = (data ?? []) as string[];
    if (!paths.length) return;
    const { error } = await admin.storage.from(RECORDINGS_BUCKET).remove(paths);
    if (!error) await admin.rpc("recording_forget", { p_paths: paths });
  } catch (e) {
    log("error", "recordings.cleanup", { error: String(e) });
  }
}
