"use client";

import type { AppError } from "@dhulka/core/errors";
import { generatePassword } from "@dhulka/core/password";
import { Button } from "@dhulka/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Field } from "@dhulka/ui/field";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { Ban, KeyRound, LogOut, Mail, RotateCcw, ShieldOff, Trash2, UserCheck, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { FormError } from "@/components/forms/form-error";
import { PasswordInput } from "@/components/forms/password-input";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage, useValidationMessage } from "@/lib/client/errors";
import { deleteUserAction, setUserPasswordAction, userStatusAction } from "../actions";

type StatusAction = "suspend" | "reactivate" | "force_signout" | "reset_2fa" | "send_reset_link" | "resend_invite";

interface Props {
  userId: string;
  email: string;
  status: "active" | "invited" | "suspended" | "deleted";
  hasTotp: boolean;
  isSelf: boolean;
  canHardDelete: boolean;
  perms: { manage: boolean; resetPassword: boolean; reset2fa: boolean; forceSignout: boolean; remove: boolean; invite: boolean };
}

function Row({ icon, title, body, action }: { icon: ReactNode; title: ReactNode; body: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-0 sm:flex-row sm:items-center">
      <div className="flex flex-1 gap-3">
        <div className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function UserSecurityPanel({ userId, email, status, hasTotp, isSelf, canHardDelete, perms }: Props) {
  const t = useTranslations("admin.users.security");
  const tc = useTranslations("common");
  const vm = useValidationMessage();
  const errorText = useErrorMessage();
  const router = useRouter();
  const [confirm, setConfirm] = useState<StatusAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<AppError | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [hard, setHard] = useState(false);
  const [myPassword, setMyPassword] = useState("");
  const [delError, setDelError] = useState<AppError | null>(null);

  async function runStatus(action: StatusAction) {
    setBusy(true);
    const res = await userStatusAction({ userId, action });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) return toast.error(errorText(res.error), { description: `${tc("reference")}: ${res.error.requestId.slice(0, 8)}` });
    toast.success(t(`done.${action}`));
    router.refresh();
  }

  if (status === "deleted") return <Alert tone="warning" title={t("deletedTitle")}>{t("deletedBody")}</Alert>;

  return (
    <div className="space-y-6">
      {isSelf && <Alert tone="info">{t("selfNote")}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {perms.resetPassword && !isSelf && (
            <Row
              icon={<KeyRound />}
              title={t("passwordTitle")}
              body={t("passwordBody")}
              action={
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
                    {t("setPassword")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirm("send_reset_link")}>
                    <Mail aria-hidden />
                    {t("sendLink")}
                  </Button>
                </div>
              }
            />
          )}
          {perms.invite && status === "invited" && (
            <Row icon={<Mail />} title={t("inviteTitle")} body={t("inviteBody", { email })} action={<Button variant="outline" size="sm" onClick={() => setConfirm("resend_invite")}>{t("resendInvite")}</Button>} />
          )}
          {perms.reset2fa && !isSelf && (
            <Row
              icon={<ShieldOff />}
              title={t("mfaTitle")}
              body={hasTotp ? t("mfaOn") : t("mfaOff")}
              action={<Button variant="outline" size="sm" disabled={!hasTotp} onClick={() => setConfirm("reset_2fa")}>{t("reset2fa")}</Button>}
            />
          )}
          {perms.forceSignout && (
            <Row icon={<LogOut />} title={t("signoutTitle")} body={t("signoutBody")} action={<Button variant="outline" size="sm" onClick={() => setConfirm("force_signout")}>{t("signout")}</Button>} />
          )}
          {perms.manage && !isSelf && (
            <Row
              icon={status === "suspended" ? <UserCheck /> : <Ban />}
              title={status === "suspended" ? t("reactivateTitle") : t("suspendTitle")}
              body={status === "suspended" ? t("reactivateBody") : t("suspendBody")}
              action={
                status === "suspended" ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirm("reactivate")}>
                    <RotateCcw aria-hidden />
                    {t("reactivate")}
                  </Button>
                ) : (
                  <Button variant="destructive" size="sm" onClick={() => setConfirm("suspend")}>
                    {t("suspend")}
                  </Button>
                )
              }
            />
          )}
          {perms.remove && !isSelf && (
            <Row
              icon={<Trash2 />}
              title={t("deleteTitle")}
              body={t("deleteBody")}
              action={
                <Button variant="destructive" size="sm" onClick={() => setDelOpen(true)}>
                  {t("delete")}
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? t(`confirm.${confirm}.title`) : ""}
        description={confirm ? t(`confirm.${confirm}.body`, { email }) : ""}
        confirmLabel={tc("confirm")}
        cancelLabel={tc("cancel")}
        destructive={confirm === "suspend" || confirm === "reset_2fa"}
        loading={busy}
        onConfirm={() => confirm && void runStatus(confirm)}
      />

      <ConfirmDialog
        open={pwOpen}
        onOpenChange={(o) => {
          setPwOpen(o);
          if (!o) {
            setNewPassword("");
            setPwError(null);
          }
        }}
        title={t("setPassword")}
        description={t("setPasswordBody")}
        confirmLabel={tc("save")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          setPwError(null);
          const res = await setUserPasswordAction({ userId, mode: "password", password: newPassword });
          setBusy(false);
          if (!res.ok) return setPwError(res.error);
          await navigator.clipboard.writeText(newPassword).catch(() => undefined);
          toast.success(t("done.set_password"));
          setPwOpen(false);
          setNewPassword("");
        }}
      >
        <FormError error={pwError} />
        <div className="flex items-end gap-2">
          <Field id="newPassword" label={t("newPassword")} className="flex-1" error={vm(pwError?.fieldErrors?.password?.[0])}>
            <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="button" variant="outline" onClick={() => setNewPassword(generatePassword())}>
            <Wand2 aria-hidden />
            {t("generate")}
          </Button>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={delOpen}
        onOpenChange={(o) => {
          setDelOpen(o);
          if (!o) {
            setMyPassword("");
            setDelError(null);
            setHard(false);
          }
        }}
        title={t("deleteTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={hard ? t("hardDelete") : t("delete")}
        cancelLabel={tc("cancel")}
        destructive
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          setDelError(null);
          const res = await deleteUserAction({ userId, hard, password: myPassword });
          setBusy(false);
          if (!res.ok) return setDelError(res.error);
          toast.success(t("done.deleted"));
          router.push("/admin/users");
        }}
      >
        <FormError error={delError} />
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1 accent-primary" checked={!hard} onChange={() => setHard(false)} />
            <span>
              <span className="font-medium">{t("softDelete")}</span>
              <span className="block text-muted-foreground">{t("softDeleteBody")}</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 ${canHardDelete ? "" : "opacity-50"}`}>
            <input type="radio" className="mt-1 accent-primary" disabled={!canHardDelete} checked={hard} onChange={() => setHard(true)} />
            <span>
              <span className="font-medium">{t("hardDelete")}</span>
              <span className="block text-muted-foreground">{canHardDelete ? t("hardDeleteBody") : t("hardDeleteBlocked")}</span>
            </span>
          </label>
          <Field id="myPassword" label={t("yourPassword")} hint={t("yourPasswordHint")} error={vm(delError?.fieldErrors?.password?.[0])} required>
            <PasswordInput value={myPassword} onChange={(e) => setMyPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
