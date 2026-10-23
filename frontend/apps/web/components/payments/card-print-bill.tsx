"use client";

import type { AppError } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Card } from "@dhulka/ui/card";
import { Input } from "@dhulka/ui/input";
import { Mono } from "@dhulka/ui/misc";
import { toast } from "@dhulka/ui/toaster";
import { IdCard, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { billCardPrintAction, findCardsForPrintAction, type CardForPrint } from "@/app/[locale]/(staff)/cashier/card-actions";
import { FormError } from "@/components/forms/form-error";
import { useRouter } from "@/i18n/navigation";

/** Cashier → ID card print: when a customer asks for their card, raise its print bill, then take payment in To collect. */
export function CardPrintBill() {
  const t = useTranslations("payments.cardPrint");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<CardForPrint[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const find = async () => {
    setBusy("find");
    setError(null);
    const res = await findCardsForPrintAction({ q });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setCards(res.data);
  };
  const bill = async (c: CardForPrint) => {
    setBusy(c.id);
    setError(null);
    const res = await billCardPrintAction({ cardId: c.id });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    toast.success(res.data.existing ? t("billExists", { number: res.data.number }) : t("billed", { number: res.data.number }));
    router.refresh();
    void find();
  };
  const state = (c: CardForPrint) =>
    c.print_count > 0 ? t("printed") : c.invoice_status === "paid" ? t("paid") : c.invoice_number ? t("billOpen", { number: c.invoice_number }) : t("noBill");

  return (
    <Card className="mt-5 overflow-hidden">
      <div className="border-b p-4">
        <h2 className="flex items-center gap-2 font-medium">
          <IdCard className="size-4" aria-hidden />
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
      </div>
      <form
        className="flex flex-wrap gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} className="max-w-xs font-mono" aria-label={t("placeholder")} />
        <Button type="submit" variant="outline" loading={busy === "find"} disabled={q.trim().length < 3}>
          <Search aria-hidden />
          {t("find")}
        </Button>
      </form>
      <div className="px-4 pb-4">
        <FormError error={error} />
        {cards && cards.length === 0 && <p className="text-muted-foreground text-sm">{t("none")}</p>}
        {cards && cards.length > 0 && !cards[0]!.fee_on && <p className="text-status-pending text-sm">{t("feeOff")}</p>}
        {cards && cards.length > 0 && (
          <ul className="divide-y rounded-md border">
            {cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <span className="min-w-36 font-medium">{c.holder ?? "—"}</span>
                <Mono className="text-muted-foreground text-xs">{c.serial}</Mono>
                <span className="text-muted-foreground text-xs">{state(c)}</span>
                {c.fee_on && c.print_count === 0 && !c.invoice_number && (
                  <Button size="sm" className="ms-auto" loading={busy === c.id} onClick={() => void bill(c)}>
                    {t("createBill")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
