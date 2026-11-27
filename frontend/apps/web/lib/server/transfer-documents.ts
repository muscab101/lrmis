import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const TRANSFER_DOCS_BUCKET = "transfer-documents";
/** Largest file staff may attach to a transfer (50 MB, the storage limit). */
export const TRANSFER_DOC_MAX = 50 * 1024 * 1024;
/** The files a transfer takes (the database checks the same list): documents, photos, video and audio. */
export { TRANSFER_DOC_EXT } from "@/lib/transfer-files";

export interface TransferDocument {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  url: string | null;
  category: string;
  description: string | null;
  uploaded_by: string | null;
  uploader: string | null;
}

/** A transfer's documents with short-lived download links. Only documents the caller may see are listed. */
export async function listTransferDocuments(transferId: string): Promise<TransferDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transfer_documents")
    .select("id, file_name, mime_type, size_bytes, uploaded_at, storage_path, category, description, uploaded_by")
    .eq("transfer_id", transferId)
    .order("uploaded_at");
  const rows = (data ?? []) as (Omit<TransferDocument, "url" | "uploader"> & { storage_path: string })[];
  if (rows.length === 0) return [];
  const admin = await createAdminClient();
  const { data: signed } = await admin.storage.from(TRANSFER_DOCS_BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    // Short-lived: the files are only shown on the page, never handed out.
    900,
  );
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter((x): x is string => !!x))];
  const names = ids.length ? (((await supabase.rpc("staff_display_names", { p_user_ids: ids })).data ?? []) as { user_id: string; full_name: string }[]) : [];
  return rows.map(({ storage_path, ...r }) => ({
    ...r,
    url: byPath.get(storage_path) ?? null,
    uploader: names.find((n) => n.user_id === r.uploaded_by)?.full_name ?? null,
  }));
}
