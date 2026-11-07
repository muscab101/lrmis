import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const PROFILE_PHOTO_BUCKET = "profile-photos";

// Links last an hour; the same one is handed out for 50 minutes. Saves a trip to storage on every page, and the
// browser keeps the photo instead of downloading it again under a new link.
const LINK_SECONDS = 3600;
const REUSE_MS = 50 * 60_000;
const links = new Map<string, { url: string; until: number }>();

/** A short-lived link to someone's own profile photo, or null when they have none. */
export async function profilePhotoUrl(path: string | null | undefined) {
  if (!path) return null;
  const kept = links.get(path);
  if (kept && kept.until > Date.now()) return kept.url;
  const admin = await createAdminClient();
  const { data } = await admin.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrl(path, LINK_SECONDS);
  if (!data?.signedUrl) return null;
  if (links.size > 2000) links.clear();
  links.set(path, { url: data.signedUrl, until: Date.now() + REUSE_MS });
  return data.signedUrl;
}

/** Short-lived links to many profile photos at once, by their stored path. */
export async function profilePhotoUrls(paths: (string | null | undefined)[]) {
  const found = new Map<string, string>();
  const wanted: string[] = [];
  for (const p of new Set(paths.filter((p): p is string => !!p))) {
    const kept = links.get(p);
    if (kept && kept.until > Date.now()) found.set(p, kept.url);
    else wanted.push(p);
  }
  if (!wanted.length) return found;
  const admin = await createAdminClient();
  const { data } = await admin.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrls(wanted, LINK_SECONDS);
  if (links.size > 2000) links.clear();
  for (const d of data ?? [])
    if (d.path && d.signedUrl) {
      found.set(d.path, d.signedUrl);
      links.set(d.path, { url: d.signedUrl, until: Date.now() + REUSE_MS });
    }
  return found;
}

/** Swaps each row's stored photo path for a link to the photo. */
export async function withPhotos<T extends { photo_path?: string | null }>(
  rows: T[],
): Promise<(Omit<T, "photo_path"> & { photo: string | null; photo_key: string | null })[]> {
  const links = await profilePhotoUrls(rows.map((r) => r.photo_path));
  return rows.map(({ photo_path, ...rest }) => ({
    ...rest,
    photo: photo_path ? (links.get(photo_path) ?? null) : null,
    // The stored path: the same photo keeps the same key, while its link changes on every load.
    photo_key: photo_path ?? null,
  }));
}
