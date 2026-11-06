"use client";

import { Button } from "@dhulka/ui/button";
import { toast } from "@dhulka/ui/toaster";
import { CopyCheck, FilePlus2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { checkDuplicatesAction, checkMissingAction, createMissingAction, fixDuplicatesAction, type DuplicateCopy, type MissingBill } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";

/** Check for bills raised twice (one stays, the others are cancelled), and for bills a parcel should have and doesn't. */
export function InvoiceTools({ canFixDuplicates, canCreateMissing }: { canFixDuplicates: boolean; canCreateMissing: boolean }) {
  const t = useTranslations("billing.tools");
  const format = useFormatter();
  const locale = useLocale();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const fee = (x: { fee_so: string; fee_en: string }) => (locale === "so" ? x.fee_so : x.fee_en);
  const [busy, setBusy] = useState<"duplicates" | "missing" | null>(null);
  const [copies, setCopies] = useState<DuplicateCopy[] | null>(null);
  const [missing, setMissing] = useState<MissingBill[] | null>(null);
  const removable = copies?.filter((c) => !c.keep && !c.has_money).length ?? 0;
  const failed = () => toast.error(t("checkFailed"));

  return (
    <>
      {canFixDuplicates && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy === "duplicates"}
          onClick={async () => {
            setBusy("duplicates");
            const res = await checkDuplicatesAction({});
            setBusy(null);
            if (res.ok) setCopies(res.data ?? []);
            else failed();
          }}
        >
          <CopyCheck aria-hidden />
          {t("duplicates")}
        </Button>
      )}
      {canCreateMissing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={busy === "missing"}
          onClick={async () => {
            setBusy("missing");
            const res = await checkMissingAction({});
            setBusy(null);
            if (res.ok) setMissing(res.data ?? []);
            else failed();
          }}
        >
          <FilePlus2 aria-hidden />
          {t("missing")}
        </Button>
      )}

      {copies && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setCopies(null)}
          className="sm:max-w-xl"
          title={t("duplicatesTitle")}
          description={copies.length === 0 ? t("duplicatesNone") : removable > 0 ? t("duplicatesBody", { count: removable }) : t("duplicatesOnlyMoney")}
          confirmLabel={removable > 0 ? t("duplicatesFix") : t("close")}
          destructive={removable > 0}
          hideCancel={removable === 0}
          submit={() => (removable > 0 ? fixDuplicatesAction({}) : Promise.resolve({ ok: true as const, data: null }))}
          onDone={(d) => {
            const r = d as { cancelled: number; left: number } | null;
            if (r) toast.success(t("duplicatesDone", { count: r.cancelled }));
          }}
        >
          {() =>
            copies.length > 0 && (
              <ul className="max-h-80 divide-y overflow-auto rounded-md border text-sm">
                {copies.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs">{c.number}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {c.pun ?? "—"} · {fee(c)} · {usd(c.total)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-xs font-medium ${c.keep ? "text-status-approved" : c.has_money ? "text-status-pending" : "text-status-rejected"}`}>
                      {c.keep ? t("keep") : c.has_money ? t("hasMoney") : t("remove")}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </FormDialog>
      )}

      {missing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setMissing(null)}
          className="sm:max-w-xl"
          title={t("missingTitle")}
          description={missing.length === 0 ? t("missingNone") : t("missingBody", { count: missing.length })}
          confirmLabel={missing.length > 0 ? t("missingCreate") : t("close")}
          hideCancel={missing.length === 0}
          submit={() => (missing.length > 0 ? createMissingAction({ parcelIds: [...new Set(missing.map((m) => m.parcel_id))] }) : Promise.resolve({ ok: true as const, data: null }))}
          onDone={(d) => {
            if (d !== null) toast.success(t("missingDone", { count: Number(d) }));
          }}
        >
          {() =>
            missing.length > 0 && (
              <ul className="max-h-80 divide-y overflow-auto rounded-md border text-sm">
                {missing.map((m) => (
                  <li key={`${m.parcel_id}-${m.code}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs">{m.pun ?? m.house_no ?? "—"}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[fee(m), m.owners].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{usd(m.amount)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </FormDialog>
      )}
    </>
  );
}
