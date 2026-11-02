"use client";

import type { AppError } from "@dhulka/core/errors";
import { generatePassword } from "@dhulka/core/password";
import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { KeyRound, Mail, Trash2, UserCheck, UserX, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TestLoginButton } from "@/components/activity/test-login";
import { FormError } from "@/components/forms/form-error";
import { PasswordInput } from "@/components/forms/password-input";
import { useRouter } from "@/i18n/navigation";
import { useValidationMessage } from "@/lib/client/errors";
import { changeUserEmailAction, deleteUserAction, setUserPasswordAction, userStatusAction } from "./actions";

export interface UserRowPerms {
  /** Sign in as the user to test it. */
  test: boolean;
  changeEmail: boolean;
  resetPassword: boolean;
  remove: boolean;
  /** Deactivate someone who left the job, or activate them again. */
  manage: boolean;
}

/**
 * Deactivate / activate, change email, set password and delete for one row of the users list. Changing the
 * email and deleting need the admin's own password; the user is signed out either way.
 */
export function UserRowActions({
  user,
  perms,
  canTest,
}: {
  user: { user_id: string; email: string | null; full_name: string | null; status: string };
  perms: UserRowPerms;
  canTest: boolean;
}) {
  const t = useTranslations("admin.users.security");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const router = useRouter();
  const [open, setOpen] = useState<"email" | "password" | "delete" | "status" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [email, setEmail] = useState(user.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [myPassword, setMyPassword] = useState("");
  const [hard, setHard] = useState(false);

  const show = (which: "email" | "password" | "delete" | "status") => {
    setError(null);
    setEmail(user.email ?? "");
    setNewPassword("");
    setMyPassword("");
    setHard(false);
    setOpen(which);
  };
  const close = (o: boolean) => !o && setOpen(null);
  const deactivating = user.status === "active";
  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: AppError }>, done: string) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(done);
    setOpen(null);
    router.refresh();
  }
  const key = (label: string, className: string, icon: React.ReactNode, which: "email" | "password" | "delete" | "status") => (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon-sm" className={className} aria-label={label} onClick={() => show(which)}>
        {icon}
      </Button>
    </Tooltip>
  );

  return (
    <>
      <div className="flex justify-end gap-0.5">
        {canTest && <TestLoginButton userId={user.user_id} name={user.full_name || (user.email ?? "")} size="icon-sm" />}
        {perms.manage && user.status === "active" && key(t("suspend"), "text-warning", <UserX aria-hidden />, "status")}
        {perms.manage && user.status === "suspended" && key(t("reactivate"), "text-success", <UserCheck aria-hidden />, "status")}
        {perms.changeEmail && key(t("changeEmail"), "text-primary", <Mail aria-hidden />, "email")}
        {perms.resetPassword && key(t("setPassword"), "text-success", <KeyRound aria-hidden />, "password")}
        {perms.remove && key(t("delete"), "text-danger", <Trash2 aria-hidden />, "delete")}
      </div>

      <ConfirmDialog
        open={open === "status"}
        onOpenChange={close}
        title={t(deactivating ? "confirm.suspend.title" : "confirm.reactivate.title")}
        description={t(deactivating ? "confirm.suspend.body" : "confirm.reactivate.body", { email: user.full_name || user.email || "" })}
        confirmLabel={t(deactivating ? "suspend" : "reactivate")}
        cancelLabel={tc("cancel")}
        destructive={deactivating}
        loading={busy}
        onConfirm={() =>
          run(() => userStatusAction({ userId: user.user_id, action: deactivating ? "suspend" : "reactivate" }), t(deactivating ? "done.suspend" : "done.reactivate"))
        }
      >
        <FormError error={error} />
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "email"}
        onOpenChange={close}
        title={t("changeEmailTitle", { name: user.full_name || user.email || "" })}
        description={t("changeEmailBody")}
        confirmLabel={tc("save")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() => run(() => changeUserEmailAction({ userId: user.user_id, email, password: myPassword }), t("done.change_email"))}
      >
        <FormError error={error} />
        <div className="space-y-3">
          <Field id={`email-${user.user_id}`} label={t("newEmail")} error={vm(error?.fieldErrors?.email?.[0])} required>
            <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id={`email-pw-${user.user_id}`} label={t("yourPassword")} hint={t("yourPasswordHint")} error={vm(error?.fieldErrors?.password?.[0])} required>
            <PasswordInput value={myPassword} onChange={(e) => setMyPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "password"}
        onOpenChange={close}
        title={t("setPassword")}
        description={t("setPasswordBody")}
        confirmLabel={tc("save")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={() =>
          run(async () => {
            const res = await setUserPasswordAction({ userId: user.user_id, mode: "password", password: newPassword });
            if (res.ok) await navigator.clipboard.writeText(newPassword).catch(() => undefined);
            return res;
          }, t("done.set_password"))
        }
      >
        <FormError error={error} />
        <div className="flex items-end gap-2">
          <Field id={`pw-${user.user_id}`} label={t("newPassword")} className="flex-1" error={vm(error?.fieldErrors?.password?.[0])}>
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="button" variant="outline" onClick={() => setNewPassword(generatePassword())}>
            <Wand2 aria-hidden />
            {t("generate")}
          </Button>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={open === "delete"}
        onOpenChange={close}
        title={t("deleteTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={hard ? t("hardDelete") : t("delete")}
        cancelLabel={tc("cancel")}
        destructive
        loading={busy}
        onConfirm={() => run(() => deleteUserAction({ userId: user.user_id, hard, password: myPassword }), t("done.deleted"))}
      >
        <FormError error={error} />
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1 accent-primary" checked={!hard} onChange={() => setHard(false)} />
            <span>
              <span className="font-medium">{t("softDelete")}</span>
              <span className="block text-muted-foreground">{t("softDeleteBody")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1 accent-primary" checked={hard} onChange={() => setHard(true)} />
            <span>
              <span className="font-medium">{t("hardDelete")}</span>
              <span className="block text-muted-foreground">{t("hardDeleteListBody")}</span>
            </span>
          </label>
          <Field id={`del-pw-${user.user_id}`} label={t("yourPassword")} hint={t("yourPasswordHint")} error={vm(error?.fieldErrors?.password?.[0])} required>
            <PasswordInput value={myPassword} onChange={(e) => setMyPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}
