"use client";

import type { AppError } from "@dhulka/core/errors";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/** Translate a validation key ("validation.required") coming from a shared Zod schema. */
export function useValidationMessage() {
  const t = useTranslations("validation");
  return useCallback(
    (message: string | undefined): string | undefined => {
      if (!message) return undefined;
      const key = message.startsWith("validation.") ? message.slice("validation.".length) : null;
      return key && t.has(key) ? t(key) : message;
    },
    [t],
  );
}

/** Translate an action error to a full sentence (so/en). Never "Failed! try again please". */
export function useErrorMessage() {
  const te = useTranslations("errors");
  return useCallback(
    (error: AppError): string => {
      const values = { minutes: 15, remaining: 0, detail: "", ...(error.values ?? {}) };
      return te.has(`codes.${error.code}`) ? te(`codes.${error.code}`, values) : te("codes.UNKNOWN", values);
    },
    [te],
  );
}

/** Push server field errors into react-hook-form so they show under the right input. */
export function applyFieldErrors<T extends FieldValues>(error: AppError, setError: UseFormSetError<T>): boolean {
  if (!error.fieldErrors) return false;
  let applied = false;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    if (field === "_form" || !messages[0]) continue;
    setError(field as Path<T>, { type: "server", message: messages[0] });
    applied = true;
  }
  return applied;
}
