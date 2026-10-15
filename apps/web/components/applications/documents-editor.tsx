"use client";

import type { ApplicationType } from "@dhulka/core/schemas";
import { DOCUMENT_MAX_BYTES } from "@dhulka/core/schemas";
import { StatusBadge } from "@dhulka/ui/badge";
import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { Eye, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { documentUrlAction, removeDocumentAction, uploadDocumentAction } from "@/app/[locale]/(staff)/applications/actions";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";
import type { ApplicationDetail } from "@/lib/server/applications";

interface Props {
  application: ApplicationDetail;
  docTypes: { code: string; name_so: string; name_en: string; required_for: ApplicationType[] }[];
  editable: boolean;
}

/** Typed document checklist (§4.1): required ones first, upload / view / remove. */
export function DocumentsEditor({ application, docTypes, editable }: Props) {
  const t = useTranslations("applications");
  const tc = useTranslations("common");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const errorText = useErrorMessage();
  const vm = useValidationMessage();
  const [busy, setBusy] = useState<string | null>(null);

  const required = new Set(docTypes.filter((d) => d.required_for.includes(application.type)).map((d) => d.code));
  const ordered = [...docTypes].sort((a, b) => Number(required.has(b.code)) - Number(required.has(a.code)));
  const byType = new Map<string, ApplicationDetail["application_documents"]>();
  for (const d of application.application_documents) byType.set(d.doc_type, [...(byType.get(d.doc_type) ?? []), d]);

  async function upload(docType: string, file: File | undefined) {
    if (!file) return;
    if (file.size > DOCUMENT_MAX_BYTES) return toast.error(vm("validation.file_too_big"));
    setBusy(docType);
    const form = new FormData();
    form.set("applicationId", application.id);
    form.set("docType", docType);
    form.set("file", file);
    const res = await uploadDocumentAction(form);
    setBusy(null);
    if (!res.ok) {
      const field = res.error.fieldErrors?.file?.[0];
      return toast.error(field ? vm(field) : errorText(res.error));
    }
    toast.success(t("uploaded"));
    router.refresh();
  }

  async function open(docId: string) {
    const res = await documentUrlAction({ docId });
    if (!res.ok) return toast.error(errorText(res.error));
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  }

  async function remove(docId: string) {
    setBusy(docId);
    const res = await removeDocumentAction({ docId });
    setBusy(null);
    if (!res.ok) return toast.error(errorText(res.error));
    router.refresh();
  }

  // Only show optional types that have files, unless editing.
  const visible = ordered.filter((d) => editable || required.has(d.code) || byType.has(d.code));

  return (
    <ul className="divide-y rounded-md border">
      {visible.map((d) => {
        const files = byType.get(d.code) ?? [];
        const missing = required.has(d.code) && files.length === 0;
        return (
          <li key={d.code} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 font-medium">
                {locale === "so" ? d.name_so : d.name_en}
                {required.has(d.code) && <span className="ms-2 text-xs font-normal text-muted-foreground">{t("required")}</span>}
              </span>
              {missing && <StatusBadge tone="pending">{t("missing")}</StatusBadge>}
              {editable && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                  {busy === d.code ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
                  {t("upload")}
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                    capture={d.code === "site_photo" ? "environment" : undefined}
                    disabled={busy !== null}
                    onChange={(e) => {
                      void upload(d.code, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1 ps-7">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                    <span className="text-xs text-muted-foreground">{format.number(f.size_bytes / 1024, { maximumFractionDigits: 0 })} KB</span>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void open(f.id)} aria-label={t("view")}>
                      <Eye aria-hidden />
                    </Button>
                    {editable && (
                      <Button type="button" variant="ghost" size="icon-sm" disabled={busy === f.id} onClick={() => void remove(f.id)} aria-label={tc("delete")}>
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
