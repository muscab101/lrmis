"use client";

import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { approvePosCashierAction } from "@/app/[locale]/(staff)/collections/actions";
import { ROW_ICON } from "@/components/collections/row-icon";
import { FormDialog } from "@/components/forms/form-dialog";

/** Approve all of one cashier's waiting payments at one point of sale, after a confirm. */
export function PosApprove({
  pos,
  cashier,
  name,
  amount,
  count,
  from,
  to,
  district = null,
}: {
  pos: string;
  cashier: string;
  name: string;
  amount: string;
  count: number;
  from: string;
  to: string;
  /** For a district's online payments: only that district's. */
  district?: string | null;
}) {
  const t = useTranslations("collections.pos");
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* A plain icon, no button box; the name shows on hover and is read out by screen readers. */}
      <button
        type="button"
        className={`${ROW_ICON} text-primary hover:text-primary/80`}
        onClick={() => setOpen(true)}
        aria-label={t("approveTitle", { name })}
        title={t("approve")}
      >
        <CheckCheck aria-hidden />
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("approveTitle", { name })}
        description={t("approveBody", { count, amount })}
        confirmLabel={t("approve")}
        submit={() => approvePosCashierAction({ pos, cashier, from, to, district })}
        successMessage={t("approved", { name })}
      />
    </>
  );
}
