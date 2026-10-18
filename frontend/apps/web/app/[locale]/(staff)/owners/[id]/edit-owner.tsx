"use client";

import { Button } from "@dhulka/ui/button";
import { Tooltip } from "@dhulka/ui/form-controls";
import { Dialog, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";
import type { PartyRow } from "@/lib/server/applications";

/** Edit sheet; `iconOnly` gives the small pencil used in table rows. */
export function EditOwner({ party, districts, iconOnly = false }: { party: PartyRow; districts: { id: string; name_so: string; name_en: string }[]; iconOnly?: boolean }) {
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      {iconOnly ? (
        <Tooltip content={tc("edit")}>
          <Button variant="ghost" size="icon-sm" className="text-success" aria-label={tc("edit")} onClick={() => setOpen(true)}>
            <Pencil aria-hidden />
          </Button>
        </Tooltip>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
          {tc("edit")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-2xl" closeLabel={tc("close")}>
          <div className="border-b px-6 py-5">
            <DialogTitle className="text-lg font-semibold">{t("edit")}</DialogTitle>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <PartyForm
              party={party}
              districts={districts}
              onCancel={() => setOpen(false)}
              onSaved={() => {
                toast.success(tc("saved"));
                setOpen(false);
                router.refresh();
              }}
            />
          </div>
        </SheetContent>
      </Dialog>
    </>
  );
}
