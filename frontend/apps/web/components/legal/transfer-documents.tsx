"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { toast } from "@dhulka/ui/toaster";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { removeTransferDocumentAction, uploadTransferDocumentAction } from "@/app/[locale]/(staff)/transfers/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";

/** File types staff may attach (matches the server check). */
export const TRANSFER_DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.rtf,.txt,.csv,.jpg,.jpeg,.png,.webp,.heic,.gif,.tif,.tiff";

export interface TransferDocItem {
  id: string;
  file_name: string;
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
    const fd = new FormData();
    fd.set("transferId", transferId);
    fd.set("file", file);
    const r = await uploadTransferDocumentAction(fd);
    if (!r.ok) {
      failed++;
      const field = r.error.fieldErrors?.documents?.[0];
      show(`${file.name}: ${field ? messages.vm(field) : messages.em(r.error)}`);
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
            <input ref={input} type="file" multiple accept={TRANSFER_DOC_ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
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
              <li key={d.id} className="flex items-center gap-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("documentsHint")}</p>
      </CardContent>
    </Card>
  );
}
