"use client";

import type { AppError } from "@dhulka/core/errors";
import { isErrorCode } from "@dhulka/core/errors";
import { loginSchema, type LoginInput } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Separator } from "@dhulka/ui/misc";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/forms/form-error";
import { PasswordInput } from "@/components/forms/password-input";
import { Link } from "@/i18n/navigation";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import { googleSignInAction, loginAction } from "../actions";

export function LoginForm({ next, initialError, googleEnabled }: { next?: string | undefined; initialError: string | null; googleEnabled: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const vm = useValidationMessage();
  const [error, setError] = useState<AppError | null>(
    initialError && isErrorCode(initialError) ? { code: initialError, requestId: "—" } : null,
  );
  const [googleLoading, setGoogleLoading] = useState(false);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await loginAction(values);
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      setError(res.error);
      return;
    }
    // Full navigation so middleware runs the password-change / 2FA gates with fresh cookies.
    window.location.assign(next ?? `/${locale}/${res.data.kind === "staff" ? "dashboard" : "portal"}`);
  });

  return (
    <div className="space-y-5">
      <FormError error={error} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="email" label={t("email")} error={vm(form.formState.errors.email?.message)} required>
          <Input type="email" autoComplete="username" inputMode="email" {...form.register("email")} />
        </Field>
        <Field id="password" label={t("password")} error={vm(form.formState.errors.password?.message)} required>
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            {t("forgotPassword")}
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          {t("signIn")}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            {t("or")}
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            loading={googleLoading}
            onClick={async () => {
              setGoogleLoading(true);
              const res = await googleSignInAction({ locale: locale as "so" | "en", next: next ? next.slice(3) : "/dashboard" });
              if (res.ok) window.location.assign(res.data.url);
              else {
                setError(res.error);
                setGoogleLoading(false);
              }
            }}
          >
            <GoogleMark />
            {t("signInWithGoogle")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t("googleStaffOnly")}</p>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t("areYouCitizen")}{" "}
        <Link href="/citizen/login" className="font-medium text-primary hover:underline">
          {t("citizenLoginLink")}
        </Link>
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}
