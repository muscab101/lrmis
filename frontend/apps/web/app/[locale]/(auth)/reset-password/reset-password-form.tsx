"use client";

import type { AppError } from "@dhulka/core/errors";
import { resetPasswordSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/forms/form-error";
import { applyFieldErrors } from "@/lib/client/errors";
import { resetPasswordAction } from "../actions";
import { PasswordFields } from "../password-fields";

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [error, setError] = useState<AppError | null>(null);
  const form = useForm<z.input<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await resetPasswordAction(values);
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      return setError(res.error);
    }
    window.location.assign(`/${locale}/dashboard`);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={error} />
      <PasswordFields register={form.register} errors={form.formState.errors} />
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        {t("setPasswordContinue")}
      </Button>
    </form>
  );
}
