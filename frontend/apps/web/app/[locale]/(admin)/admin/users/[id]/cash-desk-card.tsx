"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useValidationMessage } from "@/lib/client/errors";
import { setUserPosAction } from "../actions";

/** The cashier's own cash desk: one of the desks in their districts. */
export function CashDeskCard({
  userId,
  current,
  desks,
  canEdit,
}: {
  userId: string;
  current: string | null;
  desks: { id: string; code: string; name: string; district: string }[];
  canEdit: boolean;
}) {
  const t = useTranslations("admin.pos");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const [posId, setPosId] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("cashDesk")}</CardTitle>
        <CardDescription>{t("cashDeskHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormError error={error && !error.fieldErrors ? error : null} />
        {desks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noDesksInDistricts")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field id="posId" label={t("pointOfSale")} className="min-w-64 flex-1" error={vm(error?.fieldErrors?.posId?.[0])}>
              <NativeSelect value={posId} disabled={!canEdit} onChange={(e) => setPosId(e.target.value)}>
                <option value="">{t("noDesk")}</option>
                {desks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name} ({d.district})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {canEdit && (
              <Button
                loading={busy}
                disabled={posId === (current ?? "")}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await setUserPosAction({ userId, posId: posId || null });
                  setBusy(false);
                  if (!res.ok) return setError(res.error);
                  toast.success(tc("saved"));
                }}
              >
                {tc("save")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
