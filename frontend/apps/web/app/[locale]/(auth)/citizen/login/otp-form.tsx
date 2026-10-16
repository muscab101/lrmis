"use client";

import type { AppError } from "@dhulka/core/errors";
import { otpRequestSchema, otpVerifySchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/forms/form-error";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import { otpRequestAction, otpVerifyAction } from "../../actions";

export function OtpForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const vm = useValidationMessage();
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const request = useForm<z.input<typeof otpRequestSchema>>({ resolver: zodResolver(otpRequestSchema), defaultValues: { phone: "+252" } });
  const verify = useForm<z.input<typeof otpVerifySchema>>({ resolver: zodResolver(otpVerifySchema), defaultValues: { phone: "", token: "" } });

  const sendCode = request.handleSubmit(async (values) => {
    setError(null);
    const res = await otpRequestAction({ ...values, locale: locale === "en" ? "en" : "so" });
    if (!res.ok) {
      applyFieldErrors(res.error, request.setError);
      return setError(res.error);
    }
    const normalised = otpRequestSchema.parse(values).phone;
    setPhone(normalised);
    setDevCode(res.data.devCode);
    verify.reset({ phone: normalised, token: "" });
  });

  const checkCode = verify.handleSubmit(async (values) => {
    setError(null);
    const res = await otpVerifyAction(values);
    if (!res.ok) {
      applyFieldErrors(res.error, verify.setError);
      return setError(res.error.code === "VALIDATION" ? null : res.error);
    }
    window.location.assign(`/${locale}/portal`);
  });

  return (
    <div className="space-y-4">
      <FormError error={error} />
      {!phone ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(request.formState.errors.phone?.message)} required>
            <Input type="tel" autoComplete="tel" inputMode="tel" {...request.register("phone")} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={request.formState.isSubmitting}>
            {t("sendCode")}
          </Button>
        </form>
      ) : (
        <form onSubmit={checkCode} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">{t("codeSentTo", { phone })}</p>
          {devCode && (
            <p className="rounded-md border border-dashed bg-muted/50 p-3 text-sm">
              {t("devCode")} <span className="font-mono text-base font-semibold tracking-widest">{devCode}</span>
            </p>
          )}
          <Field id="token" label={t("code")} error={vm(verify.formState.errors.token?.message)} required>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center font-mono text-lg tracking-[0.5em]" {...verify.register("token")} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={verify.formState.isSubmitting}>
            {t("verifyCode")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setPhone(null)}>
            {t("changePhone")}
          </Button>
        </form>
      )}
    </div>
  );
}
