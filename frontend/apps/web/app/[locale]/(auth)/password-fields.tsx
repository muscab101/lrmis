"use client";

import { PASSWORD_MIN_LENGTH } from "@dhulka/core/password";
import { Field } from "@dhulka/ui/field";
import { useTranslations } from "next-intl";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { PasswordInput } from "@/components/forms/password-input";
import { useValidationMessage } from "@/lib/client/errors";

interface Values {
  password: string;
  confirm: string;
  current?: string;
}

export function PasswordFields<T extends Values>({
  register,
  errors,
  withCurrent = false,
}: {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  withCurrent?: boolean;
}) {
  const t = useTranslations("auth");
  const vm = useValidationMessage();
  const reg = register as unknown as UseFormRegister<Values>;
  const errs = errors as FieldErrors<Values>;
  return (
    <>
      {withCurrent && (
        <Field id="current" label={t("currentPassword")} error={vm(errs.current?.message)} required>
          <PasswordInput autoComplete="current-password" {...reg("current")} />
        </Field>
      )}
      <Field
        id="password"
        label={t("newPassword")}
        hint={t("passwordRules", { min: PASSWORD_MIN_LENGTH })}
        error={vm(errs.password?.message)}
        required
      >
        <PasswordInput autoComplete="new-password" {...reg("password")} />
      </Field>
      <Field id="confirm" label={t("confirmPassword")} error={vm(errs.confirm?.message)} required>
        <PasswordInput autoComplete="new-password" {...reg("confirm")} />
      </Field>
    </>
  );
}
