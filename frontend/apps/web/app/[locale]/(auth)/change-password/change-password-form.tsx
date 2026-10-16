"use client";

import type { AppError } from "@dhulka/core/errors";
import { changePasswordSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/forms/form-error";
import { applyFieldErrors } from "@/lib/client/errors";
import { changePasswordAction } from "../actions";
import { PasswordFields } from "../password-fields";

type Values = z.input<typeof changePasswordSchema>;

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [error, setError] = useState<AppError | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(changePasswordSchema), defaultValues: { current: "", password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await changePasswordAction(values);
    if (!res.ok) {
      const onField = applyFieldErrors(res.error, form.setError);
      return setError(onField && res.error.code !== "PASSWORD_BREACHED" ? null : res.error);
    }
    toast.success(t("passwordChanged"));
    // Next gate (2FA) or the dashboard — middleware decides.
    window.location.assign(`/${locale}/dashboard`);
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={error} />
      <PasswordFields register={form.register} errors={form.formState.errors} withCurrent />
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        {forced ? t("setPasswordContinue") : t("changePassword")}
      </Button>
    </form>
  );
}
