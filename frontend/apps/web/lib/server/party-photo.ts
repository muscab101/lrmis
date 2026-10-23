import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const PARTY_PHOTO_BUCKET = "party-photos";

/**
 * A short-lived link to an owner's photo, or null when there is none. The database checks that the caller
 * may see the owner; only then is the private file signed.
 */
export async function partyPhotoUrl(partyId: string | null | undefined) {
  if (!partyId) return null;
  const supabase = await createClient();
  const { data: path } = await supabase.rpc("party_photo_path", { p_id: partyId });
  if (!path) return null;
  const admin = await createAdminClient();
  const { data } = await admin.storage.from(PARTY_PHOTO_BUCKET).createSignedUrl(path as string, 600);
  return data?.signedUrl ?? null;
}
