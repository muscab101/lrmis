import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "./log";

export const RECORDINGS_BUCKET = "staff-recordings";

/** Removes recordings past the 30 days: the files first, then their rows, 500 at a time until none are left. */
export async function removeExpiredRecordings() {
  try {
    const admin = await createAdminClient();
    // At most 40 rounds (20,000 files) in one go, so a page visit never hangs.
    for (let round = 0; round < 40; round++) {
      const { data } = await admin.rpc("recording_expired", { p_limit: 500 });
      const paths = (data ?? []) as string[];
      if (!paths.length) return;
      const { error } = await admin.storage.from(RECORDINGS_BUCKET).remove(paths);
      if (error) return;
      await admin.rpc("recording_forget", { p_paths: paths });
      if (paths.length < 500) return;
    }
  } catch (e) {
    log("error", "recordings.cleanup", { error: String(e) });
  }
}
