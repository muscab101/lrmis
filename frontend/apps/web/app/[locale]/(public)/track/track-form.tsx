"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { Input } from "@dhulka/ui/input";
import { Alert, Mono } from "@dhulka/ui/misc";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import type { ApplicationStatus } from "@dhulka/core/schemas";
import { ApplicationStatusBadge } from "@/components/applications/status-badge";
import { FormError } from "@/components/forms/form-error";
import { useValidationMessage } from "@/lib/client/errors";
import { trackAction } from "./actions";

export function TrackForm({ initialNumber }: { initialNumber: string }) {
  const t = useTranslations("track");
  const ta = useTranslations("applications");
  const vm = useValidationMessage();
  const format = useFormatter();
  const [number, setNumber] = useState(initialNumber);
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof trackAction>> | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await trackAction({ number, phoneLast4: last4 });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResult(res);
  }

  const found = result?.ok ? result.data : undefined;

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end" noValidate>
        <Field id="number" label={t("number")} error={vm(error?.fieldErrors?.number?.[0])} required>
          <Input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="APP-2026-000123" className="font-mono uppercase" />
        </Field>
        <Field id="last4" label={t("last4")} error={vm(error?.fieldErrors?.phoneLast4?.[0])} required>
          <Input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} className="font-mono" />
        </Field>
        <Button type="submit" loading={busy} className={error?.fieldErrors ? "sm:mb-5" : undefined}>
          {t("check")}
        </Button>
      </form>
      <FormError error={error && !error.fieldErrors ? error : null} />

      {result?.ok && !found && <Alert tone="warning" title={t("notFoundTitle")}>{t("notFoundBody")}</Alert>}

      {found && (
        <Card>
          <CardContent className="space-y-5 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <Mono className="text-lg">{found.number}</Mono>
              <ApplicationStatusBadge status={found.status as ApplicationStatus} />
            </div>
            <p className="text-sm text-muted-foreground">
              {ta(`types.${found.type}`)} · {found.district}
              {found.submitted_at && ` · ${ta("submittedOn", { date: format.dateTime(new Date(found.submitted_at), { dateStyle: "medium" }) })}`}
            </p>
            <ol className="relative space-y-4 border-s ps-6">
              {found.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -start-[29px] top-1.5 size-2.5 rotate-45 bg-flag" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <ApplicationStatusBadge status={e.status as ApplicationStatus} />
                    <span className="text-xs text-muted-foreground">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
