"use client";

import { DATA_SCOPES } from "@dhulka/core/permissions";
import type { AppError } from "@dhulka/core/errors";
import { roleSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Input, Textarea } from "@dhulka/ui/input";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { createRoleAction, resetRoleAction, updateRoleAction } from "@/app/[locale]/(admin)/admin/roles/actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import { PermissionMatrix } from "./permission-matrix";

type Values = z.input<typeof roleSchema>;

const PRESET_COLOURS = ["#1E4FA3", "#0EA5A4", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#0F172A", "#64748B"];

interface Props {
  mode: "create" | "edit";
  roleId?: string;
  initial: Values;
  isSystem?: boolean;
  isProtected?: boolean;
  canEdit: boolean;
  isSuperAdmin: boolean;
  myPermissions: string[];
  myScopeRank: number;
}

export function RoleForm({ mode, roleId, initial, isSystem = false, isProtected = false, canEdit, isSuperAdmin, myPermissions, myScopeRank }: Props) {
  const t = useTranslations("admin.roles");
  const tu = useTranslations("admin.users");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [error, setError] = useState<AppError | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const readOnly = !canEdit || isProtected;
  const mine = new Set(myPermissions);

  const form = useForm<Values>({ resolver: zodResolver(roleSchema), defaultValues: initial });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const parsed = roleSchema.parse(values);
    const res =
      mode === "create"
        ? await createRoleAction({ ...parsed, idempotencyKey, copyFromRoleId: null })
        : await updateRoleAction({ ...parsed, roleId: roleId! });
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      return setError(res.error);
    }
    toast.success(mode === "create" ? t("created") : tc("saved"));
    if (mode === "create" && res.data) router.push(`/admin/roles/${(res.data as { roleId: string }).roleId}`);
    else router.refresh();
  });

  const scopeRank = { own: 0, district: 1, districts: 2, all: 3 } as const;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {isProtected && <Alert tone="info" title={t("protectedTitle")}>{t("protectedBody")}</Alert>}
      <FormError error={error} />

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {/* One name, saved for both languages. */}
          <Field id="nameEn" label={t("name")} error={vm(errors.nameEn?.message ?? errors.nameSo?.message)} required className="sm:col-span-2">
            <Input disabled={readOnly} {...form.register("nameEn", { onChange: (e) => form.setValue("nameSo", e.target.value) })} />
          </Field>
          <Field id="description" label={t("description")} error={vm(errors.description?.message)} className="sm:col-span-2">
            <Textarea rows={2} disabled={readOnly} {...form.register("description")} />
          </Field>
          <Controller
            control={form.control}
            name="colour"
            render={({ field }) => (
              <Field id="colour" label={t("colour")} error={vm(errors.colour?.message)}>
                <div className="flex flex-wrap items-center gap-2">
                  {PRESET_COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={readOnly}
                      onClick={() => field.onChange(c)}
                      className="size-7 rounded-full border-2 transition-transform focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                      style={{ backgroundColor: c, borderColor: field.value.toUpperCase() === c ? "var(--foreground)" : "transparent" }}
                      aria-label={c}
                      aria-pressed={field.value.toUpperCase() === c}
                    />
                  ))}
                  <input
                    type="color"
                    value={field.value}
                    disabled={readOnly}
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    className="h-7 w-10 cursor-pointer rounded border bg-transparent"
                    aria-label={t("customColour")}
                  />
                </div>
              </Field>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionScope")}</CardTitle>
          <CardDescription>{t("scopeHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Controller
            control={form.control}
            name="dataScope"
            render={({ field }) => (
              <div role="radiogroup" aria-label={t("sectionScope")} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {DATA_SCOPES.map((s) => {
                  const allowed = isSuperAdmin || scopeRank[s] <= myScopeRank || field.value === s;
                  return (
                    <label key={s} className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${field.value === s ? "border-primary/40 bg-primary-soft/50" : ""} ${!allowed || readOnly ? "cursor-not-allowed opacity-50" : ""}`}>
                      <input type="radio" className="mt-1 accent-primary" checked={field.value === s} disabled={readOnly || !allowed} onChange={() => field.onChange(s)} />
                      <span>
                        <span className="font-medium">{tu(`scope.${s}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`scopeHelp_${s}`)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="maxWaiver" label={t("maxWaiver")} hint={t("limitHint")}>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={readOnly}
                {...form.register("limits.maxWaiverAmount", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })}
              />
            </Field>
            <Field id="maxRefund" label={t("maxRefund")} hint={t("limitHint")}>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={readOnly}
                {...form.register("limits.maxRefundAmount", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionPermissions")}</CardTitle>
          <CardDescription>{t("permissionsHelp", { count: form.watch("permissions")?.length ?? 0 })}</CardDescription>
        </CardHeader>
        <CardContent>
          {isProtected ? (
            <p className="text-sm text-muted-foreground">{t("allPermissions")}</p>
          ) : (
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <PermissionMatrix value={field.value ?? []} onChange={field.onChange} grantable={(p) => isSuperAdmin || mine.has(p)} readOnly={readOnly} />
              )}
            />
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {mode === "edit" && isSystem && (
              <Button type="button" variant="outline" onClick={() => setResetOpen(true)}>
                <RotateCcw aria-hidden />
                {t("resetDefault")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/admin/roles")}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {mode === "create" ? t("create") : tc("saveChanges")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("resetDefault")}
        description={t("resetBody")}
        confirmLabel={t("resetDefault")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          const res = await resetRoleAction({ roleId: roleId! });
          setBusy(false);
          setResetOpen(false);
          if (!res.ok) return setError(res.error);
          toast.success(t("resetDone"));
          window.location.reload();
        }}
      />
    </form>
  );
}
