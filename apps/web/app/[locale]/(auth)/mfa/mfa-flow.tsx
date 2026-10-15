"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Mono, Skeleton } from "@dhulka/ui/misc";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useValidationMessage } from "@/lib/client/errors";
import { mfaStartAction, mfaVerifyAction } from "../actions";

type Start = { mode: "verify"; factorId: string } | { mode: "enroll"; factorId: string; qrCode: string; secret: string };

export function MfaFlow() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const vm = useValidationMessage();
  const [start, setStart] = useState<Start | null>(null);
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void mfaStartAction({}).then((res) => (res.ok ? setStart(res.data) : setError(res.error)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!start || submitting) return;
    setSubmitting(true);
    setFieldError(undefined);
    setError(null);
    const res = await mfaVerifyAction({ factorId: start.factorId, code });
    if (!res.ok) {
      setSubmitting(false);
      const msg = res.error.fieldErrors?.code?.[0];
      return msg ? setFieldError(msg) : setError(res.error);
    }
    window.location.assign(`/${locale}/dashboard`);
  }

  if (!start) return error ? <FormError error={error} /> : <Skeleton className="h-64 w-full" />;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FormError error={error} />
      {start.mode === "enroll" && (
        <ol className="space-y-4 text-sm">
          <li>
            <p className="mb-3">{t("mfaStep1")}</p>
            <div className="flex justify-center rounded-md border bg-white p-4">
              {/* Supabase returns the QR as an SVG data URL */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={start.qrCode} alt={t("mfaQrAlt")} className="size-44" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("mfaManual")} <Mono className="break-all select-all">{start.secret}</Mono>
            </p>
          </li>
          <li>{t("mfaStep2")}</li>
        </ol>
      )}
      <Field id="code" label={t("code")} error={vm(fieldError)} required>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="text-center font-mono text-lg tracking-[0.5em]"
          autoFocus
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={submitting} disabled={code.length !== 6}>
        {start.mode === "enroll" ? t("mfaEnable") : t("verifyCode")}
      </Button>
    </form>
  );
}
