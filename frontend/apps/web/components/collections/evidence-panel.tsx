"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { FileText, Paperclip } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { uploadEvidenceAction } from "@/app/[locale]/(staff)/payments/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { PaymentExtras } from "@/lib/server/collections";

/** Receipt photos, statement pages and SMS screenshots kept with a payment. */
export function EvidencePanel({ paymentId, files, canAdd }: { paymentId: string; files: PaymentExtras["evidence"]; canAdd: boolean }) {
  const t = useTranslations("collections.evidence");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const upload = async (file: File) => {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set("paymentId", paymentId);
    form.set("note", note);
    form.set("file", file);
    const res = await uploadEvidenceAction(form);
    setSaving(false);
    if (input.current) input.current.value = "";
    if (!res.ok) return setError(res.error);
    setNote("");
    toast.success(t("saved"));
    router.refresh();
  };
  const fieldError = vm(error?.fieldErrors?.file?.[0]);

  return (
    <div className="space-y-3 text-sm">
      {files.length === 0 ? (
        <p className="text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((f) => (
            <li key={f.id} className="overflow-hidden rounded-md border">
              {f.url && f.content_type.startsWith("image/") ? (
                <a href={f.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL */}
                  <img src={f.url} alt={f.file_name} className="h-36 w-full bg-muted object-contain" />
                </a>
              ) : (
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="flex h-36 items-center justify-center gap-2 bg-muted text-muted-foreground hover:text-foreground">
                  <FileText className="size-6" aria-hidden />
                  PDF
                </a>
              )}
              <div className="space-y-0.5 px-3 py-2">
                <p className="truncate font-medium">{f.file_name}</p>
                {f.note && <p className="text-muted-foreground">{f.note}</p>}
                <p className="text-xs text-muted-foreground">
                  {[f.by, format.dateTime(new Date(f.uploaded_at), { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="grid min-w-48 flex-1 gap-1">
            <span className="text-xs text-muted-foreground">{t("note")}</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("notePlaceholder")} />
          </label>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => input.current?.click()}>
            <Paperclip aria-hidden />
            {saving ? t("uploading") : t("add")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{t("hint")}</p>
        </div>
      )}
      {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : error && <FormError error={error} />}
    </div>
  );
}
