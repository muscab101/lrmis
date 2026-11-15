"use client";

import { Button } from "@dhulka/ui/button";
import { Checkbox } from "@dhulka/ui/form-controls";
import { toast } from "@dhulka/ui/toaster";
import { CalendarX2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { checkMissedYearlyAction, createMissedYearlyAction, type MissedYearly } from "@/app/[locale]/(staff)/billing/actions";
import { FormDialog } from "@/components/forms/form-dialog";
import { fullHouseNo } from "@/lib/house-no";

/**
 * Billing runs: check for land whose anniversary came without a yearly bill (the automatic billing missed it), tick the
 * ones to bill, and make billing runs for them (one per district and year, approved and issued as usual).
 */
export function MissedBills({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("billing.missed");
  const format = useFormatter();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<MissedYearly[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const all = list !== null && list.length > 0 && chosen.size === list.length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const res = await checkMissedYearlyAction({});
          setBusy(false);
          if (!res.ok) return toast.error(t("checkFailed"));
          setList(res.data);
          setChosen(new Set(res.data.map((m) => m.parcel_id)));
        }}
      >
        <CalendarX2 aria-hidden />
        {t("check")}
      </Button>
      {list && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setList(null)}
          className="sm:max-w-2xl"
          title={t("title")}
          description={list.length === 0 ? t("none") : t("body", { count: list.length })}
          confirmLabel={list.length > 0 && canCreate ? t("create", { count: chosen.size }) : t("close")}
          hideCancel={list.length === 0 || !canCreate}
          submit={() =>
            list.length > 0 && canCreate && chosen.size > 0
              ? createMissedYearlyAction({ parcelIds: [...chosen] })
              : Promise.resolve({ ok: true as const, data: null })
          }
          onDone={(d) => {
            const runs = d as { number: string; bills: number }[] | null;
            if (runs) toast.success(t("done", { count: runs.length, list: runs.map((r) => r.number).join(", ") }));
          }}
        >
          {() =>
            list.length > 0 && (
              <div className="space-y-2">
                {canCreate && (
                  <label className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={all ? true : chosen.size ? "indeterminate" : false}
                      onCheckedChange={(on) => setChosen(new Set(on === true ? list.map((m) => m.parcel_id) : []))}
                    />
                    {t("chooseAll")}
                  </label>
                )}
                <ul className="max-h-96 divide-y overflow-auto rounded-md border text-sm">
                  {list.map((m) => (
                    <li key={m.parcel_id} className="flex items-center gap-3 px-3 py-2">
                      {canCreate && (
                        <Checkbox
                          checked={chosen.has(m.parcel_id)}
                          aria-label={m.pun ?? m.parcel_id}
                          onCheckedChange={(on) =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (on === true) next.add(m.parcel_id);
                              else next.delete(m.parcel_id);
                              return next;
                            })
                          }
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs">{m.pun ?? fullHouseNo(m.neighbourhood_code, m.house_no) ?? "—"}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {[locale === "so" ? m.district_so : m.district_en, m.owners].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-end text-xs">
                        <span className="block">{t("yearDue", { year: m.year })}</span>
                        <span className="text-muted-foreground block">
                          {format.dateTime(new Date(m.anniversary), { dateStyle: "medium" })}
                          {m.before_automatic && ` · ${t("beforeAutomatic")}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">{t("note")}</p>
              </div>
            )
          }
        </FormDialog>
      )}
    </>
  );
}
