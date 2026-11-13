"use client";

import type { ComboOption } from "@dhulka/ui/combobox";
import { Button } from "@dhulka/ui/button";
import { Switch } from "@dhulka/ui/form-controls";
import { Input } from "@dhulka/ui/input";
import { Alert, EmptyState, Mono } from "@dhulka/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@dhulka/ui/table";
import { toast } from "@dhulka/ui/toaster";
import { Scale } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { saveNeighbourhoodPricesAction } from "@/app/[locale]/(staff)/valuation/actions";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useErrorMessage } from "@/lib/client/errors";
import type { Grade, PricedNeighbourhood } from "@/lib/server/valuation";
import { NeighbourhoodPicker } from "./neighbourhood-picker";

/**
 * Rates: choose a neighbourhood and set its price per m² for each house type. Bills for land there use these prices;
 * a type left empty uses its normal price (Property grades). Without a choice, the neighbourhoods with prices of their own.
 */
export function RatesPanel({
  selected,
  grades,
  prices,
  priced,
  canEdit,
}: {
  selected: ComboOption | null;
  grades: Grade[];
  /** The chosen neighbourhood's own prices, by house type id. */
  prices: Record<string, number>;
  priced: PricedNeighbourhood[];
  canEdit: boolean;
}) {
  const t = useTranslations("valuation");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const errorMessage = useErrorMessage();
  const money = (n: number) => format.number(Number(n), { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const name = (g: { name_so: string; name_en: string }) => (locale === "so" ? g.name_so : g.name_en);
  const start = () => Object.fromEntries(grades.map((g) => [g.id, prices[g.id] != null ? String(prices[g.id]) : ""]));
  const [values, setValues] = useState<Record<string, string>>(start);
  const [busy, setBusy] = useState(false);
  const [rebill, setRebill] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = grades.some((g) => (values[g.id] ?? "") !== (prices[g.id] != null ? String(prices[g.id]) : ""));

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setProblem(null);
    // The house types whose price here changed (set, changed or cleared).
    const changedIds = grades.filter((g) => (values[g.id] ?? "").trim() !== (prices[g.id] != null ? String(prices[g.id]) : "")).map((g) => g.id);
    const res = await saveNeighbourhoodPricesAction({
      neighbourhoodId: selected.value,
      prices: grades.map((g) => ({ gradeId: g.id, amount: (values[g.id] ?? "").trim() === "" ? null : Number(values[g.id]) })),
      rebillGradeIds: rebill ? changedIds : [],
    });
    setBusy(false);
    if (!res.ok) return setProblem(errorMessage(res.error));
    const r = res.data.rebilled;
    toast.success(
      r ? t("pricesSavedRebilled", { place: selected.label, changed: r.changed, paidMore: r.paid_more }) : t("pricesSaved", { place: selected.label }),
    );
    router.refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="w-full max-w-sm">
          <NeighbourhoodPicker value={selected} onChange={(o) => router.replace(`${pathname}?tab=rates${o ? `&n=${o.value}` : ""}`)} />
        </div>
        <p className="text-muted-foreground max-w-md text-xs">{t("ratesHelp")}</p>
      </div>

      {!selected ? (
        priced.length === 0 ? (
          <EmptyState icon={<Scale />} title={t("noPriced")} description={t("noPricedBody")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("neighbourhood")}</TableHead>
                <TableHead className="text-end">{t("ownPrices")}</TableHead>
                <TableHead className="text-end">{t("changed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priced.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="text-sm">
                    <Link href={`/valuation?tab=rates&n=${n.id}`} className="hover:text-primary font-medium">
                      {name(n)}
                    </Link>{" "}
                    <Mono className="text-muted-foreground text-xs">{[n.district_code, n.code].filter(Boolean).join("-")}</Mono>
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{n.prices}</TableCell>
                  <TableCell className="text-muted-foreground text-end text-xs">{format.relativeTime(new Date(n.updated_at))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : (
        <div className="space-y-3 p-4">
          {problem && <Alert tone="danger" title={problem} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("houseType")}</TableHead>
                <TableHead className="text-end">{t("normalPrice")}</TableHead>
                <TableHead className="w-48 text-end">{t("priceHere", { place: selected.label })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grades.map((g) => {
                const own = (values[g.id] ?? "").trim() !== "";
                return (
                  <TableRow key={g.id} className={g.active ? "" : "text-muted-foreground"}>
                    <TableCell className="text-sm">
                      {name(g)}
                      {!g.active && <span className="ms-2 text-xs">({t("inactive")})</span>}
                    </TableCell>
                    <TableCell className={`text-end text-sm tabular-nums ${own ? "text-muted-foreground line-through" : ""}`}>{money(g.amount)}</TableCell>
                    <TableCell className="text-end">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.0001"
                        aria-label={t("priceHere", { place: selected.label })}
                        placeholder={String(g.amount)}
                        className="ms-auto h-8 w-32 text-end"
                        disabled={!canEdit}
                        value={values[g.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [g.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-start gap-2 text-sm">
                <Switch checked={rebill} onCheckedChange={setRebill} />
                <span>
                  {t("rebillUnpaid")}
                  <span className="text-muted-foreground block text-xs">{t("rebillUnpaidHint")}</span>
                </span>
              </label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={!changed || busy} onClick={() => setValues(start())}>
                  {t("undoChanges")}
                </Button>
                <Button size="sm" loading={busy} disabled={!changed} onClick={save}>
                  {t("savePrices")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
