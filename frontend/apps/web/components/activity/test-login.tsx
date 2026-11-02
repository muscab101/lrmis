"use client";

import { Button } from "@dhulka/ui/button";
import { FlaskConical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  startTestLoginAction,
  stopTestLoginAction,
} from "@/app/[locale]/(admin)/admin/activity/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Opens the system as this user, to check they can do their work. */
export function TestLoginButton({
  userId,
  name,
  size = "default",
}: {
  userId: string;
  name: string;
  size?: "default" | "sm" | "icon-sm";
}) {
  const t = useTranslations("testLogin");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={size === "icon-sm" ? "ghost" : "outline"}
        size={size}
        aria-label={t("button")}
        title={t("button")}
        onClick={() => setOpen(true)}
      >
        <FlaskConical aria-hidden />
        {size !== "icon-sm" && t("button")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("confirmTitle", { name })}
        description={t("confirmBody")}
        confirmLabel={t("confirm")}
        submit={() => startTestLoginAction({ userId })}
        onDone={() => window.location.assign(`/${locale}/dashboard`)}
      />
    </>
  );
}

/** Stays on every page while testing, so nobody forgets whose account this is. */
export function TestingBanner({ name }: { name: string }) {
  const t = useTranslations("testLogin");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="status"
      className="bg-warning text-warning-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm font-medium"
    >
      <span>{t("banner", { name })}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-foreground"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await stopTestLoginAction({});
          if (r.ok) window.location.assign(`/${locale}/admin/users/${r.data.target}`);
          else window.location.assign(`/${locale}/login`);
        }}
      >
        {t("back")}
      </Button>
    </div>
  );
}
