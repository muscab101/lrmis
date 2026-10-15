"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@dhulka/ui/button";
import { EmptyState, Mono } from "@dhulka/ui/misc";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="flex min-h-[70dvh] items-center justify-center p-6">
      <EmptyState
        icon={<AlertTriangle />}
        title={t("crashTitle")}
        description={
          <>
            {t("crashBody")}
            {error.digest && (
              <span className="mt-2 block">
                {t("reference")}: <Mono>{error.digest}</Mono>
              </span>
            )}
          </>
        }
        action={<Button onClick={reset}>{t("tryAgain")}</Button>}
      />
    </main>
  );
}
