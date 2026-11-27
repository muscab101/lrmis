"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { toast } from "@dhulka/ui/toaster";
import { FileAudio, FileImage, FileText, FileVideo, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { prepareTransferDocumentAction, recordTransferDocumentAction, removeTransferDocumentAction, transferDocumentUrlAction } from "@/app/[locale]/(staff)/transfers/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";
import { createClient } from "@/lib/supabase/client";
import { TRANSFER_DOC_ACCEPT, TRANSFER_DOC_CATEGORIES, type TransferDocCategory } from "@/lib/transfer-files";
import { type Attachment, AttachmentGallery, formatBytes } from "./attachment-viewer";

/** Largest file (the server and storage check it too). */
export const TRANSFER_DOC_MAX = 50 * 1024 * 1024;

/** An icon for the kind of file. */
export function DocIcon({ mime, className }: { mime: string; className?: string }) {
  const Icon = mime.startsWith("video/") ? FileVideo : mime.startsWith("audio/") ? FileAudio : mime.startsWith("image/") ? FileImage : FileText;
  return <Icon className={className} aria-hidden />;
}

export type TransferDocItem = Attachment;
export { formatBytes };

/** Upload files one by one to a transfer; returns how many failed (each failure is shown as a toast). */
export async function uploadTransferFiles(
  transferId: string,
  files: File[],
  show: (msg: string) => void,
  messages: { em: ReturnType<typeof useErrorMessage>; vm: ReturnType<typeof useValidationMessage> },
  meta: { category?: TransferDocCategory; description?: string } = {},
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
    const r = await recordTransferDocumentAction({
      transferId,
      path: prep.data.path,
      name: file.name,
      mime: file.type,
      size: file.size,
      category: meta.category ?? "other",
      description: meta.description ?? "",
    });
    if (!r.ok) {
      failed++;
      show(`${file.name}: ${messages.em(r.error)}`);
    }
  }
  return failed;
}

/** The documents attached to a transfer: previews of every file, add more (with what they are) while it is open, remove while it is a draft. */
export function TransferDocuments({
  transferId,
  docs,
  canAdd,
  canRemove,
  watermark,
}: {
  transferId: string;
  docs: Attachment[];
  canAdd: boolean;
  canRemove: boolean;
  /** Written across the previews: who is looking and when. */
  watermark: string;
}) {
  const t = useTranslations("legal");
  const tf = useTranslations("legal.files");
  const router = useRouter();
  const em = useErrorMessage();
  const vm = useValidationMessage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<TransferDocCategory>("sale_agreement");
  const [description, setDescription] = useState("");

  const add = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (!files.length) return;
    setBusy(true);
    const failed = await uploadTransferFiles(transferId, files, (m) => toast.error(m), { em, vm }, { category, description });
    setBusy(false);
    if (failed < files.length) {
      toast.success(t("documentsUploaded", { count: files.length - failed }));
      setDescription("");
    }
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
        <CardTitle className="text-base">
          {t("documents")} <span className="ms-1 text-sm font-normal text-muted-foreground">({docs.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAdd && (
          <div className="grid items-end gap-3 rounded-md border border-dashed p-3 sm:grid-cols-[14rem_1fr_auto]">
            <Field id="doc-category" label={tf("category")}>
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as TransferDocCategory)}>
                {TRANSFER_DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {tf(`categories.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="doc-description" label={tf("description")}>
              <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={tf("descriptionPlaceholder")} />
            </Field>
            <div>
              <input ref={input} type="file" multiple accept={TRANSFER_DOC_ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
              <Button disabled={busy} onClick={() => input.current?.click()}>
                <Paperclip aria-hidden />
                {busy ? t("uploading") : t("addDocuments")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3">{tf("allowed")}</p>
          </div>
        )}
        {docs.length === 0 ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t("documentsNone")}</p>
        ) : (
          <AttachmentGallery items={docs} categoryLabel={(c) => tf(`categories.${c}`)} canRemove={canRemove} onRemove={(id) => void remove(id)} watermark={watermark}
            freshUrl={async (id) => {
              const r = await transferDocumentUrlAction({ id });
              return r.ok ? r.data : null;
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
