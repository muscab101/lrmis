"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogTitle, SheetContent } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PartyForm } from "@/components/owners/party-form";
import { useRouter } from "@/i18n/navigation";
import type { PartyRow } from "@/lib/server/applications";

export function EditOwner({ party, districts }: { party: PartyRow; districts: { id: string; name_so: string; name_en: string }[] }) {
  const t = useTranslations("owners");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        {tc("edit")}
      </Button>
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
