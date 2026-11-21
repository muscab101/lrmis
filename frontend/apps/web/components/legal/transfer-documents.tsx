"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { toast } from "@dhulka/ui/toaster";
import { FileAudio, FileImage, FileText, FileVideo, Paperclip, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { prepareTransferDocumentAction, recordTransferDocumentAction, removeTransferDocumentAction } from "@/app/[locale]/(staff)/transfers/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";
import { createClient } from "@/lib/supabase/client";

/** Largest file (the server and storage check it too). */
export const TRANSFER_DOC_MAX = 50 * 1024 * 1024;

/** An icon for the kind of file. */
export function DocIcon({ mime, className }: { mime: string; className?: string }) {
  const Icon = mime.startsWith("video/") ? FileVideo : mime.startsWith("audio/") ? FileAudio : mime.startsWith("image/") ? FileImage : FileText;
  return <Icon className={className} aria-hidden />;
}

export interface TransferDocItem {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  url: string | null;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Upload files one by one to a transfer; returns how many failed (each failure is shown as a toast). */
export async function uploadTransferFiles(
  transferId: string,
  files: File[],
  show: (msg: string) => void,
  messages: { em: ReturnType<typeof useErrorMessage>; vm: ReturnType<typeof useValidationMessage> },
) {
  let failed = 0;
  for (const file of files) {
    if (file.size > TRANSFER_DOC_MAX) {
      failed++;
      show(`${file.name}: ${messages.vm("validation.document_too_big")}`);
      continue;
    }
    const prep = await prepareTransferDocumentAction({ transferId, name: file.name, size: file.size });
    if (!prep.ok) {
      failed++;
      const field = prep.error.fieldErrors?.documents?.[0];
      show(`${file.name}: ${field ? messages.vm(field) : messages.em(prep.error)}`);
      continue;
    }
    const up = await createClient()
      .storage.from(prep.data.bucket)
      .uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) {
      failed++;
      show(`${file.name}: ${messages.vm("validation.document_upload_failed")}`);
      continue;
    }
    const r = await recordTransferDocumentAction({ transferId, path: prep.data.path, name: file.name, mime: file.type, size: file.size });
    if (!r.ok) {
      failed++;
      show(`${file.name}: ${messages.em(r.error)}`);
    }
  }
  return failed;
}

/** The documents attached to a transfer: download, add more while it is open, remove while it is a draft. */
export function TransferDocuments({ transferId, docs, canAdd, canRemove }: { transferId: string; docs: TransferDocItem[]; canAdd: boolean; canRemove: boolean }) {
  const t = useTranslations("legal");
  const format = useFormatter();
  const router = useRouter();
  const em = useErrorMessage();
  const vm = useValidationMessage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (!files.length) return;
    setBusy(true);
    const failed = await uploadTransferFiles(transferId, files, (m) => toast.error(m), { em, vm });
    setBusy(false);
    if (failed < files.length) toast.success(t("documentsUploaded", { count: files.length - failed }));
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const r = await removeTransferDocumentAction({ id });
    setBusy(false);
    if (!r.ok) return toast.error(em(r.error));
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("documents")}</CardTitle>
        {canAdd && (
          <>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              <Paperclip aria-hidden />
              {busy ? t("uploading") : t("addDocuments")}
            </Button>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {docs.length === 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t("documentsNone")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {docs.map((d) => (
              <li key={d.id} className="space-y-2 py-2">
                <div className="flex items-center gap-3">
                  <DocIcon mime={d.mime_type} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {d.url ? (
                      <a href={d.url} className="hover:text-primary hover:underline" target="_blank" rel="noreferrer">
                        {d.file_name}
                      </a>
                    ) : (
                      d.file_name
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(d.size_bytes)} · {format.dateTime(new Date(d.uploaded_at), { dateStyle: "medium" })}
                  </span>
                  {canRemove && (
                    <Button size="icon-sm" variant="ghost" aria-label={t("removeDocument")} disabled={busy} onClick={() => remove(d.id)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                {/* Play recordings and videos right here. */}
                {d.url && d.mime_type.startsWith("audio/") && <audio controls preload="none" src={d.url} className="w-full max-w-md" />}
                {d.url && d.mime_type.startsWith("video/") && <video controls preload="metadata" src={d.url} className="max-h-64 w-full max-w-md rounded-md bg-black" />}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("documentsHint")}</p>
      </CardContent>
    </Card>
  );
}
