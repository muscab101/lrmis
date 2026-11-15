"use client";

import { Button } from "@dhulka/ui/button";
import { Card, CardContent } from "@dhulka/ui/card";
import { Checkbox } from "@dhulka/ui/form-controls";
import { Mono } from "@dhulka/ui/misc";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";

export interface PickBill {
  id: string;
  title: string;
  number: string;
  pun: string | null;
  parcelId: string;
  balance: number;
  total: number;
  dueText: string;
  late: boolean;
  /** Open and on land that can pay: it can be chosen. */
  payable: boolean;
  notice: string | null;
}

/**
 * The citizen's bills with a tick on each open one (all ticked at first): pay them together (the yearly tax with the
 * registration bills, …) or only the ones chosen.
 */
export function BillsPicker({ bills }: { bills: PickBill[] }) {
  const t = useTranslations("portalBills");
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD" });
  const open = bills.filter((b) => b.payable);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(open.map((b) => b.id)));
  const picked = open.filter((b) => chosen.has(b.id));
  const total = picked.reduce((s, b) => s + b.balance, 0);
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = open.length > 0 && picked.length === open.length;

  return (
    <div className="space-y-3">
      {open.length > 1 && (
        <label className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={all ? true : picked.length ? "indeterminate" : false} onCheckedChange={(on) => setChosen(new Set(on === true ? open.map((b) => b.id) : []))} />
          {t("chooseAll")}
        </label>
      )}
      <ul className="space-y-3">
        {bills.map((b) => (
          <li key={b.id}>
            <Card className={b.payable && chosen.has(b.id) ? "ring-primary/40 ring-2" : undefined}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
                <div className="flex min-w-0 items-start gap-3">
                  {b.payable && <Checkbox className="mt-1" checked={chosen.has(b.id)} onCheckedChange={(on) => toggle(b.id, on === true)} aria-label={`${b.title} ${b.number}`} />}
                  <div className="min-w-0">
                    <p className="font-medium">{b.title}</p>
                    <p className="text-muted-foreground text-sm">
                      <Mono>{b.number}</Mono> ·{" "}
                      <Link href={`/portal/parcels/${b.parcelId}`} className="hover:text-primary">
                        <Mono>{b.pun ?? "—"}</Mono>
                      </Link>
                    </p>
                    <p className={`text-xs ${b.late ? "text-status-rejected" : "text-muted-foreground"}`}>{b.dueText}</p>
                  </div>
                </div>
                <div className="text-end">
                  <p className="text-xl font-semibold tabular-nums">{usd(b.balance)}</p>
                  {b.balance < b.total && <p className="text-muted-foreground text-xs">{t("ofTotal", { total: usd(b.total) })}</p>}
                </div>
                {b.notice && <p className="bg-status-pending/10 text-status-pending w-full rounded-md px-3 py-2 text-xs">{b.notice}</p>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {open.length > 0 && (
        <div className="bg-background/90 sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 shadow-lg backdrop-blur">
          <div>
            <p className="text-muted-foreground text-xs">{t("chosen", { count: picked.length })}</p>
            <p className="text-xl font-semibold tabular-nums">{usd(total)}</p>
          </div>
          {picked.length > 0 ? (
            <Button size="lg" asChild>
              <Link href={`/portal/pay-bills/${picked.map((b) => b.id).join(",")}`}>{picked.length === open.length ? t("payAll") : t("paySelected", { count: picked.length })}</Link>
            </Button>
          ) : (
            <Button size="lg" disabled>
              {t("pay")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
