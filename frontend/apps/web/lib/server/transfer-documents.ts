import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const TRANSFER_DOCS_BUCKET = "transfer-documents";
/** Largest file staff may attach to a transfer (20 MB). */
export const TRANSFER_DOC_MAX = 20 * 1024 * 1024;
/** Any ordinary office file or picture. */
export const TRANSFER_DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf", "txt", "csv", "jpg", "jpeg", "png", "webp", "heic", "gif", "tif", "tiff"];

export interface TransferDocument {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  url: string | null;
}

/** A transfer's documents with short-lived download links. Only documents the caller may see are listed. */
export async function listTransferDocuments(transferId: string): Promise<TransferDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transfer_documents")
    .select("id, file_name, mime_type, size_bytes, uploaded_at, storage_path")
    .eq("transfer_id", transferId)
    .order("uploaded_at");
  const rows = (data ?? []) as (Omit<TransferDocument, "url"> & { storage_path: string })[];
  if (rows.length === 0) return [];
  const admin = await createAdminClient();
  const { data: signed } = await admin.storage.from(TRANSFER_DOCS_BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    600,
    { download: true },
  );
  const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map(({ storage_path, ...r }) => ({ ...r, url: byPath.get(storage_path) ?? null }));
}
