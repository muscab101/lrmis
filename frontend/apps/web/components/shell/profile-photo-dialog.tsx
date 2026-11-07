"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { Camera, Trash2, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { removeProfilePhotoAction, uploadProfilePhotoAction } from "@/app/[locale]/(auth)/actions/profile-photo";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

/** Your own photo: upload, change or remove it. It shows in the header. */
export function ProfilePhotoDialog({ open, onOpenChange, name, photo }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; photo: string | null }) {
  const t = useTranslations("common.photo");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const fieldError = vm(error?.fieldErrors?.file?.[0]);

  const done = (message: string) => {
    toast.success(message);
    router.refresh();
  };
  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const res = await uploadProfilePhotoAction(form);
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!res.ok) return setError(res.error);
    done(t("saved"));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm" closeLabel={tc("close")}>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("body")}</DialogDescription>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="bg-muted text-muted-foreground grid size-28 place-items-center overflow-hidden rounded-full border">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL
              <img src={photo} alt={t("alt", { name })} className="size-full object-cover" />
            ) : (
              <UserRound className="size-12" aria-hidden />
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" loading={busy === "upload"} disabled={busy !== null} onClick={() => input.current?.click()}>
              <Camera aria-hidden />
              {photo ? t("change") : t("upload")}
            </Button>
            {photo && (
              <Button
                type="button"
                variant="outline"
                className="text-danger"
                loading={busy === "remove"}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("remove");
                  setError(null);
                  const res = await removeProfilePhotoAction({});
                  setBusy(null);
                  if (!res.ok) return setError(res.error);
                  done(t("removed"));
                }}
              >
                <Trash2 aria-hidden />
                {t("remove")}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-center text-xs">{t("hint")}</p>
          {fieldError ? <p className="text-danger text-xs">{fieldError}</p> : error && <FormError error={error} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
