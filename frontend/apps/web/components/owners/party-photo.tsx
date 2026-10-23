"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { Camera, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { uploadPartyPhotoAction } from "@/app/[locale]/(staff)/owners/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

/** The owner's photo (used on the ID card), with Upload / Change for staff who may set it. */
export function PartyPhoto({ partyId, url, canEdit, name }: { partyId: string; url: string | null; canEdit: boolean; name: string }) {
  const t = useTranslations("owners.photo");
  const vm = useValidationMessage();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const upload = async (file: File) => {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set("partyId", partyId);
    form.set("file", file);
    const res = await uploadPartyPhotoAction(form);
    setSaving(false);
    if (input.current) input.current.value = "";
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    router.refresh();
  };
  const fieldError = vm(error?.fieldErrors?.file?.[0]);

  return (
    <div className="flex items-center gap-4">
      <div className="grid h-28 w-22 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL
          <img src={url} alt={t("alt", { name })} className="size-full object-cover" />
        ) : (
          <UserRound className="size-10" aria-hidden />
        )}
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <p className="text-muted-foreground">{url ? t("onCard") : t("none")}</p>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => input.current?.click()}>
              <Camera aria-hidden />
              {saving ? t("uploading") : url ? t("change") : t("upload")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
          </>
        )}
        {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : error && <FormError error={error} />}
      </div>
    </div>
  );
}
