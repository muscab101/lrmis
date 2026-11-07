import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

export const MARKS_BUCKET = "certificate-marks";
export const MARK_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface CertificateMarks {
  signature: {
    url: string | null;
    name: string | null;
    title: string | null;
    updatedAt: string;
  } | null;
  stamp: { url: string; updatedAt: string } | null;
}

// Links last an hour; the same one is reused for 50 minutes so the browser keeps the image.
const links = new Map<string, { url: string; until: number }>();
async function link(path: string) {
  const kept = links.get(path);
  if (kept && kept.until > Date.now()) return kept.url;
  const admin = await createAdminClient();
  const { data } = await admin.storage.from(MARKS_BUCKET).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  links.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}

/**
 * The official signature (with the signer's name and title) and the office stamp shown at the bottom of every
 * certificate. Read on the server for whoever is looking at or printing a certificate (including the print program).
 */
export const getCertificateMarks = cache(async (): Promise<CertificateMarks> => {
  const admin = await createAdminClient();
  const { data } = await admin
    .from("certificate_marks")
    .select("kind, path, signer_name, signer_title, updated_at");
  const rows = (data ?? []) as {
    kind: "signature" | "stamp";
    path: string | null;
    signer_name: string | null;
    signer_title: string | null;
    updated_at: string;
  }[];
  const sig = rows.find((r) => r.kind === "signature");
  const stp = rows.find((r) => r.kind === "stamp");
  const stampUrl = stp?.path ? await link(stp.path) : null;
  return {
    signature:
      sig && (sig.path || sig.signer_name)
        ? {
            url: sig.path ? await link(sig.path) : null,
            name: sig.signer_name,
            title: sig.signer_title,
            updatedAt: sig.updated_at,
          }
        : null,
    stamp: stampUrl ? { url: stampUrl, updatedAt: stp!.updated_at } : null,
  };
});
