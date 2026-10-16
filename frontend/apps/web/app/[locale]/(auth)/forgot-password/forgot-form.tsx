"use client";

import type { AppError } from "@dhulka/core/errors";
import { forgotPasswordSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/forms/form-error";
import { Link } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import { forgotPasswordAction } from "../actions";

export function ForgotForm() {
  const t = useTranslations("auth");
  const locale = useLocale() as "so" | "en";
  const vm = useValidationMessage();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await forgotPasswordAction({ ...values, locale });
    if (!res.ok) return setError(res.error);
    setSent(true);
  });

  if (sent) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={t("resetSentTitle")}>
          {t("resetSentBody")}
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">{t("backToLogin")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={error} />
      <Field id="email" label={t("email")} error={vm(form.formState.errors.email?.message)} required>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        {t("sendResetLink")}
      </Button>
      <Link href="/login" className="block text-center text-sm text-primary hover:underline">
        {t("backToLogin")}
      </Link>
    </form>
  );
}
