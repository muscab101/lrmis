"use client";

import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Checkbox, NativeSelect, Tooltip } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { toast } from "@dhulka/ui/toaster";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";
import { deletePosAction, savePosAction } from "./actions";

export interface PosRow {
  id: string;
  code: string;
  name: string;
  district_id: string | null;
  kind: string;
  receipt_prefix: string;
  active: boolean;
}

type District = { id: string; code: string; name_so: string; name_en: string };

/** The Add desk button (page header) or the edit / delete keys of a row. */
export function PosActions({ pos, districts }: { pos?: PosRow; districts: District[] }) {
  const t = useTranslations("admin.pos");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const start = () => ({
    code: pos?.code ?? "",
    name: pos?.name ?? "",
    districtId: pos?.district_id ?? "",
    kind: (pos?.kind === "field" ? "field" : "cashier") as "cashier" | "field",
    receiptPrefix: pos?.receipt_prefix ?? "",
    active: pos?.active ?? true,
  });
  const [v, setV] = useState(start);
  const open = () => {
    setV(start());
    setDialog("edit");
  };
  const idp = pos?.id ?? "new";

  return (
    <>
      {pos ? (
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
        title={pos ? t("editTitle", { code: pos.code }) : t("add")}
        description={t("formBody")}
        confirmLabel={tc("save")}
        successMessage={tc("saved")}
        submit={() => savePosAction({ id: pos?.id ?? null, ...v })}
      >
        {(fe) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`pos-code-${idp}`} label={t("code")} hint={t("codeHint")} error={fe("code")} required>
              <Input value={v.code} maxLength={12} className="uppercase" onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field id={`pos-prefix-${idp}`} label={t("receiptPrefix")} hint={t("receiptPrefixHint")} error={fe("receiptPrefix")}>
              <Input value={v.receiptPrefix} maxLength={16} className="uppercase" onChange={(e) => setV({ ...v, receiptPrefix: e.target.value.toUpperCase() })} />
            </Field>
            <Field id={`pos-name-${idp}`} label={t("name")} error={fe("name")} required className="sm:col-span-2">
              <Input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field id={`pos-district-${idp}`} label={t("district")} error={fe("districtId")} required>
              <NativeSelect value={v.districtId} onChange={(e) => setV({ ...v, districtId: e.target.value })}>
                <option value="">{t("choose")}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {locale === "so" ? d.name_so : d.name_en}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={`pos-kind-${idp}`} label={t("kind")}>
              <NativeSelect value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "cashier" | "field" })}>
                <option value="cashier">{t("kinds.cashier")}</option>
                <option value="field">{t("kinds.field")}</option>
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c === true })} />
              {t("activeLabel")}
            </label>
          </div>
        )}
      </FormDialog>

      {pos && (
        <FormDialog
          open={dialog === "delete"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={t("deleteTitle", { code: pos.code })}
          description={t("deleteBody")}
          confirmLabel={t("delete")}
          destructive
          submit={() => deletePosAction({ id: pos.id })}
          onDone={(d) => toast.success((d as { result: string }).result === "hidden" ? t("hidden") : t("deleted"))}
        />
      )}
    </>
  );
}
