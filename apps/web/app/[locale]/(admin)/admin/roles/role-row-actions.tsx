"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@dhulka/ui/dropdown-menu";
import { Field } from "@dhulka/ui/field";
import { NativeSelect } from "@dhulka/ui/form-controls";
import { Alert } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import type { AppError } from "@dhulka/core/errors";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";
import { deleteRoleAction } from "./actions";

interface Props {
  role: { id: string; name: string; isSystem: boolean; isProtected: boolean; users: number };
  moveOptions: { id: string; label: string }[];
  can: { create: boolean; update: boolean; remove: boolean };
}

export function RoleRowActions({ role, moveOptions, can }: Props) {
  const t = useTranslations("admin.roles");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const deletable = can.remove && !role.isSystem;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("colActions")}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => router.push(`/admin/roles/${role.id}`)}>
            <Pencil />
            {role.isProtected || !can.update ? tc("view") : tc("edit")}
          </DropdownMenuItem>
          {can.create && !role.isProtected && (
            <DropdownMenuItem onSelect={() => router.push(`/admin/roles/new?copy=${role.id}`)}>
              <Copy />
              {t("copy")}
            </DropdownMenuItem>
          )}
          {deletable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setOpen(true)}>
                <Trash2 />
                {tc("delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
        title={t("deleteTitle", { name: role.name })}
        description={role.users > 0 ? t("deleteInUse", { count: role.users }) : t("deleteBody")}
        confirmLabel={role.users > 0 ? t("moveAndDelete") : tc("delete")}
        cancelLabel={tc("cancel")}
        destructive
        loading={busy}
        onConfirm={async () => {
          if (role.users > 0 && !moveTo) return setError({ code: "ROLE_IN_USE", requestId: "—", values: { detail: String(role.users) } });
          setBusy(true);
          const res = await deleteRoleAction({ roleId: role.id, moveToRoleId: role.users > 0 ? moveTo : null });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          toast.success(t("deleted", { name: role.name }));
          setOpen(false);
          router.refresh();
        }}
      >
        <FormError error={error} />
        {role.users > 0 && (
          <>
            <Alert tone="warning">{t("moveHelp")}</Alert>
            <Field id="moveTo" label={t("moveTo")} required>
              <NativeSelect value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">{t("chooseRole")}</option>
                {moveOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
