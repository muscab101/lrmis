"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { ImageUp, PenLine, Stamp, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { SignBlock } from "@/components/documents/sign-block";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import type { CertificateMarks } from "@/lib/server/certificate-marks";
import { removeMarkAction, saveSignerAction, uploadMarkAction } from "./actions";

type Kind = "signature" | "stamp";

export function MarksEditor({ marks }: { marks: CertificateMarks }) {
  const t = useTranslations("signatureStamp");
  const format = useFormatter();
  const vm = useValidationMessage();
  const router = useRouter();
  const sigInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(marks.signature?.name ?? "");
  const [title, setTitle] = useState(marks.signature?.title ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ kind: Kind; error: AppError } | null>(null);

  const done = (message: string) => {
    toast.success(message);
    router.refresh();
  };
  const upload = async (kind: Kind, file: File) => {
    setBusy(`upload-${kind}`);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    form.set("name", name);
    form.set("title", title);
    const res = await uploadMarkAction(form);
    setBusy(null);
    (kind === "signature" ? sigInput : stampInput).current!.value = "";
    if (!res.ok) return setError({ kind, error: res.error });
    done(t(kind === "signature" ? "signatureSaved" : "stampSaved"));
  };
  const remove = async (kind: Kind) => {
    setBusy(`remove-${kind}`);
    setError(null);
    const res = await removeMarkAction({ kind });
    setBusy(null);
    if (!res.ok) return setError({ kind, error: res.error });
    done(t("removed"));
  };
  const saveSigner = async () => {
    setBusy("signer");
    setError(null);
    const res = await saveSignerAction({ name, title });
    setBusy(null);
    if (!res.ok) return setError({ kind: "signature", error: res.error });
    done(t("signerSaved"));
  };
  const updated = (at: string | undefined) =>
    at
      ? t("updated", {
          when: format.dateTime(new Date(at), { dateStyle: "medium", timeStyle: "short" }),
        })
      : null;
  const errorFor = (kind: Kind) => (error?.kind === kind ? error.error : null);

  const picker = (kind: Kind, ref: React.RefObject<HTMLInputElement | null>) => (
    <input
      ref={ref}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void upload(kind, f);
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Signature */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="size-4" aria-hidden />
              {t("signature")}
            </CardTitle>
            <CardDescription>{t("signatureHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid h-36 place-items-center rounded-md border border-dashed bg-white p-3">
              {marks.signature?.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL
                <img
                  src={marks.signature.url}
                  alt={t("signature")}
                  className="max-h-[7.5rem] max-w-full object-contain"
                />
              ) : (
                <p className="text-sm text-neutral-500">{t("noSignature")}</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="signer-name"
                label={t("signerName")}
                error={vm(errorFor("signature")?.fieldErrors?.name?.[0])}
              >
                <Input
                  id="signer-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("signerNamePlaceholder")}
                />
              </Field>
              <Field
                id="signer-title"
                label={t("signerTitle")}
                error={vm(errorFor("signature")?.fieldErrors?.title?.[0])}
              >
                <Input
                  id="signer-title"
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("signerTitlePlaceholder")}
                />
              </Field>
            </div>
            <p className="text-destructive text-sm empty:hidden">
              {vm(errorFor("signature")?.fieldErrors?.file?.[0])}
            </p>
            <FormError
              error={errorFor("signature")?.fieldErrors?.file ? null : errorFor("signature")}
            />
            <div className="flex flex-wrap items-center gap-2">
              {picker("signature", sigInput)}
              <Button type="button" onClick={() => sigInput.current?.click()} disabled={!!busy}>
                <ImageUp aria-hidden />
                {busy === "upload-signature"
                  ? t("uploading")
                  : marks.signature?.url
                    ? t("changeSignature")
                    : t("uploadSignature")}
              </Button>
              <Button type="button" variant="outline" onClick={saveSigner} disabled={!!busy}>
                {busy === "signer" ? t("saving") : t("saveSigner")}
              </Button>
              {marks.signature?.url && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => remove("signature")}
                  disabled={!!busy}
                  className="text-destructive"
                >
                  <Trash2 aria-hidden />
                  {t("remove")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs empty:hidden">
              {updated(marks.signature?.updatedAt)}
            </p>
          </CardContent>
        </Card>

        {/* Stamp */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stamp className="size-4" aria-hidden />
              {t("stamp")}
            </CardTitle>
            <CardDescription>{t("stampHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid h-36 place-items-center rounded-md border border-dashed bg-white p-3">
              {marks.stamp ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed private-storage URL
                <img
                  src={marks.stamp.url}
                  alt={t("stamp")}
                  className="max-h-[7.5rem] max-w-full object-contain"
                />
              ) : (
                <p className="text-sm text-neutral-500">{t("noStamp")}</p>
              )}
            </div>
            <p className="text-destructive text-sm empty:hidden">
              {vm(errorFor("stamp")?.fieldErrors?.file?.[0])}
            </p>
            <FormError error={errorFor("stamp")?.fieldErrors?.file ? null : errorFor("stamp")} />
            <div className="flex flex-wrap items-center gap-2">
              {picker("stamp", stampInput)}
              <Button type="button" onClick={() => stampInput.current?.click()} disabled={!!busy}>
                <ImageUp aria-hidden />
                {busy === "upload-stamp"
                  ? t("uploading")
                  : marks.stamp
                    ? t("changeStamp")
                    : t("uploadStamp")}
              </Button>
              {marks.stamp && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => remove("stamp")}
                  disabled={!!busy}
                  className="text-destructive"
                >
                  <Trash2 aria-hidden />
                  {t("remove")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs empty:hidden">
              {updated(marks.stamp?.updatedAt)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* How the bottom of a certificate will look. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
          <CardDescription>{t("previewHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border bg-white p-6 text-[#0b1a3a]">
            <div className="flex min-w-[560px] items-end justify-between gap-6 border-t border-neutral-300 pt-4">
              <div className="text-[10px]">
                <p className="text-neutral-500">{t("previewIssued")}</p>
                <p className="font-medium">—</p>
              </div>
              <SignBlock
                signature={
                  marks.signature
                    ? { url: marks.signature.url, name: name || null, title: title || null }
                    : name || title
                      ? { url: null, name: name || null, title: title || null }
                      : null
                }
                stamp={marks.stamp}
                labels={{ signature: t("signature"), stamp: t("stamp") }}
              />
              <div className="grid size-[22mm] place-items-center border border-dashed border-neutral-300 text-[9px] text-neutral-400">
                QR
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
