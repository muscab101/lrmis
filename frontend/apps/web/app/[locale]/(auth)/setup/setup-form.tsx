"use client";

import type { AppError } from "@dhulka/core/errors";
import { setupSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/forms/form-error";
import { PasswordInput } from "@/components/forms/password-input";
import { Link } from "@/i18n/navigation";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import { setupAction } from "../actions";
import { PasswordFields } from "../password-fields";

export function SetupForm() {
  const t = useTranslations("setup");
  const ta = useTranslations("auth");
  const vm = useValidationMessage();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const form = useForm<z.input<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setupToken: "", fullName: "", email: "", password: "", confirm: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await setupAction(values);
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      return setError(res.error);
    }
    setDone(true);
  });

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={t("doneTitle")}>
          {t("doneBody")}
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">{t("goToLogin")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError error={error} />
      <Field id="setupToken" label={t("token")} hint={t("tokenHint")} error={vm(form.formState.errors.setupToken?.message)} required>
        <PasswordInput autoComplete="off" {...form.register("setupToken")} />
      </Field>
      <Field id="fullName" label={t("fullName")} error={vm(form.formState.errors.fullName?.message)} required>
        <Input allow="letters" autoComplete="name" {...form.register("fullName")} />
      </Field>
      <Field id="email" label={ta("email")} error={vm(form.formState.errors.email?.message)} required>
        <Input type="email" autoComplete="username" {...form.register("email")} />
      </Field>
      <PasswordFields register={form.register} errors={form.formState.errors} />
      <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
        {t("create")}
      </Button>
    </form>
  );
}
