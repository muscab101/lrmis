"use client";

import { Button } from "@dhulka/ui/button";
import { ConfirmDialog } from "@dhulka/ui/dialog";
import { Checkbox, NativeSelect, Switch } from "@dhulka/ui/form-controls";
import { toast } from "@dhulka/ui/toaster";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function DesignInteractive() {
  const t = useTranslations("design");
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <NativeSelect defaultValue="hodan" aria-label={t("fieldDistrict")}>
        <option value="hodan">Hodan</option>
        <option value="wadajir">Wadajir</option>
      </NativeSelect>
      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox defaultChecked /> {t("checkbox")}
        </label>
        <label className="flex items-center gap-2">
          <Switch defaultChecked /> {t("switch")}
        </label>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => toast.success(t("toastSuccess"))}>
          {t("showToast")}
        </Button>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          {t("showConfirm")}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("confirmYes")}
        cancelLabel={t("confirmNo")}
        destructive
        onConfirm={() => setOpen(false)}
      />
    </div>
  );
}
