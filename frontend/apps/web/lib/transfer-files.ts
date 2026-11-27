/** The files a transfer takes: documents (PDF, Word, JPG, PNG), video (MP4, MOV, WebM) and audio (MP3, WAV, M4A, AAC, OGG). */
export const TRANSFER_DOC_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "mp4", "mov", "webm", "mp3", "wav", "m4a", "aac", "ogg"] as const;
/** For the file picker. */
export const TRANSFER_DOC_ACCEPT = TRANSFER_DOC_EXT.map((e) => `.${e}`).join(",");
/** What a file is, for the document categories on a transfer. */
export const TRANSFER_DOC_CATEGORIES = [
  "ownership_certificate",
  "sale_agreement",
  "transfer_agreement",
  "identification",
  "court_order",
  "inheritance",
  "witness",
  "payment_receipt",
  "other",
] as const;
export type TransferDocCategory = (typeof TRANSFER_DOC_CATEGORIES)[number];

/** How a file is shown: a PDF, a picture, a video, a sound recording, or another document (Word). */
export function fileKind(name: string, mime: string): "pdf" | "image" | "video" | "audio" | "other" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "webm"].includes(ext)) return "video";
  // .ogg is almost always sound (WhatsApp voice notes); an Ogg video says so in its type.
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg"].includes(ext)) return "audio";
  return "other";
}
