"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { fileObjectionAction } from "@/app/[locale]/(staff)/surveys/actions";
import { FormError } from "@/components/forms/form-error";
import { Link } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";

/** File an objection against a notice. Signing in (phone OTP) keeps objections accountable. */
export function ObjectionForm({ noticeId, signedIn }: { noticeId: string; signedIn: boolean }) {
  const t = useTranslations("notices");
  const vm = useValidationMessage();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", phone: "", statement: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <Alert tone="success" title={t("filed")}>{t("filedBody")}</Alert>;
  if (!open) {
    return signedIn ? (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("object")}
      </Button>
    ) : (
      <p className="text-sm text-muted-foreground">
        <Link href="/citizen/login" className="underline">
          {t("signInToObject")}
        </Link>
      </p>
    );
  }
  const fe = (k: string) => vm(error?.fieldErrors?.[k]?.[0]);
  return (
    <form
      className="space-y-3 rounded-md border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fileObjectionAction({ noticeId, ...v });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        setDone(true);
      }}
    >
      <FormError error={error && !error.fieldErrors ? error : null} />
      <Field id={`name-${noticeId}`} label={t("name")} error={fe("name")} required>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" />
      </Field>
      <Field id={`phone-${noticeId}`} label={t("phone")} error={fe("phone")}>
        <Input inputMode="tel" placeholder="+252…" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} autoComplete="tel" />
      </Field>
      <Field id={`statement-${noticeId}`} label={t("statement")} hint={t("statementHint")} error={fe("statement")} required>
        <Textarea rows={4} value={v.statement} onChange={(e) => setV({ ...v, statement: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
