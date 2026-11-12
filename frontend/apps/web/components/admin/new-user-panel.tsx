"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UserForm } from "@/components/admin/user-form";

/** Users page: "New user" opens the form in a side panel over the list (no separate page). */
export function NewUserPanel(props: Omit<React.ComponentProps<typeof UserForm>, "mode" | "initial" | "isSelf">) {
  const t = useTranslations("admin.users");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />
        {t("new")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-4xl">
          <div className="border-b px-6 py-4 pe-12">
            <DialogTitle className="text-base font-semibold">{t("new")}</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">{t("newSubtitle")}</DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{open && <UserForm mode="create" {...props} />}</div>
        </SheetContent>
      </Dialog>
    </>
  );
}
