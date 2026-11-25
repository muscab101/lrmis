"use client";

import { Button } from "@dhulka/ui/button";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";
import { restoreDeletedAction } from "./actions";

import type { DeletedKind as Kind } from "./kinds";

/** Restore one deleted item, after a check. */
export function RestoreButton({ kind, id, label }: { kind: Kind; id: string; label: string }) {
  const t = useTranslations("deleted");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        {t("restore")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("restoreTitle", { name: label })}
        description={t(`restoreBody.${kind}`)}
        confirmLabel={t("restore")}
        successMessage={t("restored")}
        submit={() => restoreDeletedAction({ kind, id })}
      />
    </>
  );
}
