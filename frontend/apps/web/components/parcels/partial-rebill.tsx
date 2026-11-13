"use client";

import { Button } from "@dhulka/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@dhulka/ui/dialog";
import { toast } from "@dhulka/ui/toaster";
import { BadgeCheck, ReceiptText } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { type BillCheck, registerParcelAction, rebillParcelAction } from "@/app/[locale]/(staff)/parcels/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";

/**
 * Partial land after a new size or type: its bill now and the bill the new size and type give, with Re-bill (the
 * unpaid bill follows) and Approve (move the land to registered).
 */
export function PartialRebill({
  parcelId,
  land,
  check,
  can,
  onDone,
}: {
  parcelId: string;
  /** How the land is named in the Approve question. */
  land: string;
  check: NonNullable<BillCheck>;
  can: { rebill: boolean; approve: boolean };
  onDone?: () => void;
}) {
  const t = useTranslations("parcels.rebill");
  const tf = useTranslations("parcels.fieldLand");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [now, setNow] = useState(check);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const e = now.expected;
  const type = locale === "so" ? e.type_so : e.type_en;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("billNow")}</dt>
        <dd className="tabular-nums">{now.invoice ? `${usd(now.invoice.total)} · ${now.invoice.number}` : t("noBill")}</dd>
        <dt className="text-muted-foreground">{t("billNew")}</dt>
        <dd className="font-medium tabular-nums">
          {usd(e.amount)}{" "}
          <span className="text-muted-foreground text-xs font-normal">
            ({format.number(Number(e.area), { maximumFractionDigits: 2 })} m² × {usd(e.price)} · {type})
          </span>
        </dd>
      </dl>
      {now.below_paid && <p className="text-status-rejected text-sm">{t("belowPaid")}</p>}
      {!now.differs && <p className="text-status-approved text-sm">{t("upToDate")}</p>}
      <div className="flex flex-wrap gap-2">
        {can.rebill && (
          <Button
            size="sm"
            variant={now.differs ? "default" : "outline"}
            disabled={!now.differs || now.below_paid}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await rebillParcelAction({ id: parcelId });
              setBusy(false);
              if (!res.ok) return void toast.error(errorMessage(res.error));
              if (res.data) setNow(res.data);
              toast.success(t("done"));
              router.refresh();
            }}
          >
            <ReceiptText aria-hidden />
            {t("rebill")}
          </Button>
        )}
        {can.approve && (
          <Button size="sm" variant={now.differs ? "outline" : "default"} onClick={() => setApproving(true)}>
            <BadgeCheck aria-hidden />
            {t("approve")}
          </Button>
        )}
      </div>
      <FormDialog
        open={approving}
        onOpenChange={setApproving}
        title={tf("registerTitle")}
        description={(now.differs ? `${t("approveFirst")} ` : "") + tf("registerBody", { land })}
        confirmLabel={t("approve")}
        successMessage={tf("registered")}
        submit={() => registerParcelAction({ parcelId })}
        onDone={() => onDone?.()}
      />
    </div>
  );
}

/** The same, in a window: opened after partial land's size or type is saved from a list. */
export function PartialRebillDialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PartialRebill> & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("parcels.rebill");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("body")}</DialogDescription>
        </DialogHeader>
        <PartialRebill {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
