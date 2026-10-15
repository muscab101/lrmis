"use client";

import type { AppError } from "@dhulka/core/errors";
import { Alert, Mono } from "@dhulka/ui/misc";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/lib/client/errors";

/** Form-level error: translated message + the request id staff can quote to IT Support. */
export function FormError({ error }: { error: AppError | null }) {
  const t = useTranslations("errors");
  const message = useErrorMessage();
  if (!error) return null;
  return (
    <Alert tone="danger" title={message(error)}>
      <span className="text-xs">
        {t("reference")}: <Mono>{error.requestId.slice(0, 8)}</Mono>
      </span>
    </Alert>
  );
}
