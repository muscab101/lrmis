"use client";

import type { AppError } from "@dhulka/core/errors";
import { generatePassword } from "@dhulka/core/password";
import { createUserSchema, updateUserSchema } from "@dhulka/core/schemas";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { AsyncCombobox, type ComboOption } from "@dhulka/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { cn } from "@dhulka/ui/lib/cn";
import { Alert, Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Wand2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { createUserAction, searchDistrictsAction, updateUserAction } from "@/app/[locale]/(admin)/admin/users/actions";
import { FormError } from "@/components/forms/form-error";
import { PasswordInput } from "@/components/forms/password-input";
import { useRouter } from "@/i18n/navigation";
import { applyFieldErrors, useValidationMessage } from "@/lib/client/errors";
import type { RoleLite } from "@/lib/server/users";

type CreateValues = z.input<typeof createUserSchema>;
type CreateOutput = z.output<typeof createUserSchema>;
const editSchema = updateUserSchema.omit({ userId: true });

interface Props {
  mode: "create" | "edit";
  roles: RoleLite[];
  /** Permissions of the admin filling the form (roles needing more are disabled). */
  myPermissions: string[];
  rolePermissions: Record<string, string[]>;
  isSuperAdmin: boolean;
  isSelf?: boolean;
  initial?: {
    userId: string;
    fullName: string;
    email: string;
    phone: string;
    roleIds: string[];
    allDistricts: boolean;
    districts: ComboOption[];
  };
}

export function UserForm({ mode, roles, myPermissions, rolePermissions, isSuperAdmin, isSelf = false, initial }: Props) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const locale = useLocale() as "so" | "en";
  const vm = useValidationMessage();
  const router = useRouter();
  const [error, setError] = useState<AppError | null>(null);
  const [shownPassword, setShownPassword] = useState<{ userId: string; password: string } | null>(null);
  const [districtOptions, setDistrictOptions] = useState<ComboOption[]>(initial?.districts ?? []);
  // One key per form instance: double-submits and retries return the first result.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const mine = new Set(myPermissions);
  const canGrant = (role: RoleLite) =>
    isSuperAdmin || (!role.grants_all && (rolePermissions[role.id] ?? []).every((p) => mine.has(p)));

  // Edit mode validates the same fields minus email/credentials (those can't change here).
  const resolver = (mode === "create" ? zodResolver(createUserSchema) : zodResolver(editSchema)) as unknown as Resolver<
    CreateValues,
    unknown,
    CreateOutput
  >;
  const form = useForm<CreateValues, unknown, CreateOutput>({
    resolver,
    defaultValues: {
      fullName: initial?.fullName ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      roleIds: initial?.roleIds ?? [],
      districts: initial?.allDistricts
        ? { mode: "all" }
        : { mode: "selected", districtIds: initial?.districts.map((d) => d.value) ?? [] },
      credentials: { mode: "password", password: "" },
      idempotencyKey,
    },
  });

  const searchDistricts = useCallback(
    async (q: string): Promise<ComboOption[]> => {
      const res = await searchDistrictsAction({ q });
      if (!res.ok) return [];
      return res.data.map((d) => ({ value: d.id, label: locale === "so" ? d.name_so : d.name_en, hint: d.code }));
    },
    [locale],
  );

  const credMode = form.watch("credentials.mode");
  const districtMode = form.watch("districts.mode");
  const errors = form.formState.errors as Record<string, { message?: string } | undefined> & {
    credentials?: { password?: { message?: string } };
    districts?: { districtIds?: { message?: string } };
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (mode === "create") {
      const res = await createUserAction({ ...values, phone: values.phone ?? "", locale });
      if (!res.ok) {
        applyFieldErrors(res.error, form.setError);
        return setError(res.error);
      }
      if (values.credentials.mode === "password") {
        setShownPassword({ userId: res.data.userId, password: values.credentials.password });
      } else {
        toast.success(t("invited", { email: values.email }));
        router.push(`/admin/users/${res.data.userId}`);
      }
      return;
    }
    const res = await updateUserAction({
      userId: initial!.userId,
      fullName: values.fullName,
      phone: values.phone ?? "",
      roleIds: values.roleIds,
      districts: values.districts,
    });
    if (!res.ok) {
      applyFieldErrors(res.error, form.setError);
      return setError(res.error);
    }
    toast.success(tc("saved"));
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <FormError error={error} />

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionProfile")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="fullName" label={t("fullName")} error={vm(errors.fullName?.message)} required>
            <Input autoComplete="off" {...form.register("fullName")} />
          </Field>
          <Field id="email" label={t("email")} hint={mode === "create" ? t("emailHint") : undefined} error={vm(errors.email?.message)} required>
            <Input type="email" autoComplete="off" disabled={mode === "edit"} {...form.register("email")} />
          </Field>
          <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={vm(errors.phone?.message)}>
            <Input type="tel" inputMode="tel" placeholder="+252 61 …" {...form.register("phone")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionRoles")}</CardTitle>
          <CardDescription>{isSelf ? t("selfRolesLocked") : t("rolesHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            control={form.control}
            name="roleIds"
            render={({ field }) => (
              <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" disabled={isSelf} aria-describedby="roles-error">
                <legend className="sr-only">{t("sectionRoles")}</legend>
                {roles.map((role) => {
                  const checked = field.value.includes(role.id);
                  const disabled = isSelf || (!checked && !canGrant(role));
                  return (
                    <label
                      key={role.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm transition-colors",
                        checked && "border-primary/40 bg-primary-soft/50",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(v) => field.onChange(v ? [...field.value, role.id] : field.value.filter((id) => id !== role.id))}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span className="size-2 rounded-full" style={{ backgroundColor: role.colour }} aria-hidden />
                          {locale === "so" ? role.name_so : role.name_en}
                        </span>
                        <span className="text-xs text-muted-foreground">{t(`scope.${role.data_scope}`)}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          />
          {errors.roleIds?.message && (
            <p id="roles-error" role="alert" className="mt-2 text-xs font-medium text-danger">
              {vm(errors.roleIds.message)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionDistricts")}</CardTitle>
          <CardDescription>{t("districtsHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={form.control}
            name="districts"
            render={({ field }) => (
              <div className="space-y-3">
                <div role="radiogroup" className="flex flex-wrap gap-4 text-sm">
                  {(["selected", "all"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="districtMode"
                        className="accent-primary"
                        checked={field.value.mode === m}
                        disabled={isSelf}
                        onChange={() => field.onChange(m === "all" ? { mode: "all" } : { mode: "selected", districtIds: districtOptions.map((d) => d.value) })}
                      />
                      {t(m === "all" ? "districtsAll" : "districtsSelected")}
                    </label>
                  ))}
                </div>
                {districtMode === "selected" && (
                  <Field id="districtIds" label={t("districts")} error={vm(errors.districts?.districtIds?.message)} required>
                    <AsyncCombobox
                      multiple
                      search={searchDistricts}
                      value={districtOptions}
                      disabled={isSelf}
                      onChange={(opts) => {
                        setDistrictOptions(opts);
                        field.onChange({ mode: "selected", districtIds: opts.map((o) => o.value) });
                      }}
                      placeholder={t("districtsPlaceholder")}
                      searchPlaceholder={tc("search")}
                      emptyText={tc("noResults")}
                    />
                  </Field>
                )}
              </div>
            )}
          />
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("sectionCredentials")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="radiogroup" className="flex flex-wrap gap-4 text-sm">
              {(["password", "invite"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={credMode === m}
                    onChange={() => form.setValue("credentials", m === "password" ? { mode: "password", password: "" } : { mode: "invite" })}
                  />
                  {t(m === "password" ? "credPassword" : "credInvite")}
                </label>
              ))}
            </div>
            {credMode === "password" ? (
              <div className="flex items-end gap-2">
                <Field
                  id="credentials.password"
                  label={t("tempPassword")}
                  hint={t("tempPasswordHint")}
                  error={vm(errors.credentials?.password?.message)}
                  className="flex-1"
                  required
                >
                  <PasswordInput autoComplete="new-password" {...form.register("credentials.password")} />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  className={errors.credentials?.password ? "mb-5" : undefined}
                  onClick={() => form.setValue("credentials", { mode: "password", password: generatePassword() }, { shouldValidate: true })}
                >
                  <Wand2 aria-hidden />
                  {t("generate")}
                </Button>
              </div>
            ) : (
              <Alert tone="info">{t("inviteHelp")}</Alert>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {tc("cancel")}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {mode === "create" ? t("create") : tc("saveChanges")}
        </Button>
      </div>

      <Dialog open={Boolean(shownPassword)} onOpenChange={() => undefined}>
        <DialogContent onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{t("passwordOnceTitle")}</DialogTitle>
            <DialogDescription>{t("passwordOnceBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <Mono className="flex-1 text-base break-all select-all">{shownPassword?.password}</Mono>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(shownPassword?.password ?? "");
                toast.success(tc("copied"));
              }}
            >
              <Copy aria-hidden />
              {tc("copy")}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => shownPassword && router.push(`/admin/users/${shownPassword.userId}`)}>
              {t("passwordOnceDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
