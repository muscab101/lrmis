"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";
import type { PropertyTypeRow } from "@/lib/server/property-types";
import { deletePropertyTypeAction, savePropertyTypeAction } from "./actions";

type Values = { nameSo: string; nameEn: string; price: string; currency: "USD" | "SOS"; active: boolean };
const blank: Values = { nameSo: "", nameEn: "", price: "0", currency: "USD", active: true };

/** Add-type button (page header) or the edit / delete keys of a row. */
export function PropertyTypeActions({ type }: { type?: PropertyTypeRow }) {
  const t = useTranslations("admin.propertyTypes");
  const tc = useTranslations("common");
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const start = (): Values =>
    type ? { nameSo: type.name_so, nameEn: type.name_en, price: String(type.price), currency: type.currency === "SOS" ? "SOS" : "USD", active: type.active } : blank;
  const [v, setV] = useState<Values>(start);
  const open = () => {
    setV(start());
    setDialog("edit");
  };

  return (
    <>
      {type ? (
        <div className="flex justify-end gap-0.5">
          <Tooltip content={tc("edit")}>
            <Button variant="ghost" size="icon-sm" className="text-success" aria-label={tc("edit")} onClick={open}>
              <Pencil aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content={t("delete")}>
            <Button variant="ghost" size="icon-sm" className="text-danger" aria-label={t("delete")} onClick={() => setDialog("delete")}>
              <Trash2 aria-hidden />
            </Button>
          </Tooltip>
        </div>
      ) : (
        <Button onClick={open}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      )}

      <FormDialog
        open={dialog === "edit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={type ? t("editTitle", { name: type.name_en }) : t("add")}
        description={t("formBody")}
        confirmLabel={tc("save")}
        successMessage={tc("saved")}
        submit={() => savePropertyTypeAction({ id: type?.id ?? null, nameSo: v.nameSo, nameEn: v.nameEn, price: Number(v.price || 0), currency: v.currency, active: v.active })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`pt-en-${type?.id ?? "new"}`} label={t("nameEn")} error={fe("nameEn")} required>
              <Input value={v.nameEn} maxLength={80} onChange={(e) => setV({ ...v, nameEn: e.target.value })} placeholder="Stone house" />
            </Field>
            <Field id={`pt-so-${type?.id ?? "new"}`} label={t("nameSo")} error={fe("nameSo")} required>
              <Input value={v.nameSo} maxLength={80} onChange={(e) => setV({ ...v, nameSo: e.target.value })} placeholder="Guri dhagax" />
            </Field>
            <Field id={`pt-price-${type?.id ?? "new"}`} label={t("price")} hint={t("priceHint")} error={fe("price")}>
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
            </Field>
            <Field id={`pt-cur-${type?.id ?? "new"}`} label={t("currency")}>
              <NativeSelect value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value as "USD" | "SOS" })}>
                <option value="USD">USD</option>
                <option value="SOS">SOS</option>
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c === true })} />
              {t("activeLabel")}
            </label>
          </div>
        )}
      </FormDialog>

      {type && (
        <FormDialog
          open={dialog === "delete"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("deleteTitle", { name: type.name_en })}
          description={t("deleteBody")}
          confirmLabel={t("delete")}
          destructive
          submit={() => deletePropertyTypeAction({ id: type.id })}
          onDone={(d) => toast.success((d as { result: string }).result === "hidden" ? t("hidden") : t("deleted"))}
        />
      )}
    </>
  );
}
