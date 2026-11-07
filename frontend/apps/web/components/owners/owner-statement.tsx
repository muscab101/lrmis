import { StatusBadge } from "@dhulka/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { ChevronDown, Home, Receipt } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";
import type { ParcelStatus } from "@/lib/server/parcels";

export interface OwnerHouse {
  id: string;
  pun: string | null;
  house_no: string | null;
  status: ParcelStatus;
  share_pct: number | null;
  neighbourhood_so: string | null;
  neighbourhood_en: string | null;
  district_so: string;
  district_en: string;
  balance?: number;
}

export interface Statement {
  houses: (OwnerHouse & { balance: number })[];
  years: {
    year: number;
    charged: number;
    paid: number;
    balance: number;
    bills: {
      id: string;
      number: string;
      pun: string | null;
      fee_so: string;
      fee_en: string;
      total: number;
      paid: number;
      balance: number;
      status: string;
    }[];
  }[];
  payments: { id: string; receipt_no: string; at: string; amount: number; years: number[] }[];
  totals: { charged: number; paid: number; balance: number };
}

/** Every house this owner has (one owner, many houses: no double records). */
export async function OwnerHouses({ houses }: { houses: OwnerHouse[] }) {
  const t = await getTranslations("owners.houses");
  const lang = await getLocale();
  const format = await getFormatter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Home className="size-4" aria-hidden />
          {t("title", { n: houses.length })}
        </CardTitle>
        {houses.length > 1 && <CardDescription>{t("many", { n: houses.length })}</CardDescription>}
      </CardHeader>
      {houses.length === 0 ? (
        <EmptyState icon={<Home />} title={t("none")} />
      ) : (
        <ul className="divide-y border-t">
          {houses.map((h, i) => (
            <li key={h.id}>
              <Link
                href={`/parcels/${h.id}`}
                className="hover:bg-muted/50 flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm"
              >
                <span className="bg-primary/10 text-primary grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <Mono className="font-medium">{h.pun ?? "—"}</Mono>
                  {h.house_no && (
                    <span className="text-muted-foreground ms-2">
                      {t("houseNo", { no: h.house_no })}
                    </span>
                  )}
                  <span className="text-muted-foreground block text-xs">
                    {[
                      lang === "so" ? h.neighbourhood_so : h.neighbourhood_en,
                      lang === "so" ? h.district_so : h.district_en,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {h.share_pct != null &&
                      Number(h.share_pct) < 100 &&
                      ` · ${t("share", { pct: Number(h.share_pct) })}`}
                  </span>
                </span>
                <ParcelStatusBadge status={h.status} />
                {h.balance !== undefined && (
                  <span
                    className={`w-24 text-end tabular-nums ${Number(h.balance) > 0 ? "text-danger font-medium" : "text-muted-foreground"}`}
                  >
                    {Number(h.balance) > 0 ? usd(h.balance) : t("paidUp")}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What the owner was charged each year, what they paid towards it and what is still owed. */
export async function OwnerStatement({ s }: { s: Statement }) {
  const t = await getTranslations("owners.statement");
  const lang = await getLocale();
  const format = await getFormatter();
  const usd = (n: number) => format.number(Number(n), { style: "currency", currency: "USD" });
  const owedYears = s.years.filter((y) => Number(y.balance) > 0).length;
  const yearState = (y: Statement["years"][number]) =>
    Number(y.balance) <= 0
      ? ("paid" as const)
      : Number(y.paid) > 0
        ? ("part" as const)
        : ("unpaid" as const);
  const TONE = { paid: "approved", part: "partial", unpaid: "rejected" } as const;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      {s.years.length === 0 ? (
        <EmptyState icon={<Receipt />} title={t("none")} />
      ) : (
        <CardContent className="space-y-6">
          {/* Charged − paid = still owed. */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div className="rounded-md border p-4">
              <p className="text-muted-foreground text-xs">{t("charged", { n: s.years.length })}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{usd(s.totals.charged)}</p>
            </div>
            <span className="text-muted-foreground hidden text-2xl sm:block" aria-hidden>
              −
            </span>
            <div className="rounded-md border p-4">
              <p className="text-muted-foreground text-xs">{t("paid")}</p>
              <p className="text-success mt-1 text-2xl font-semibold tabular-nums">
                {usd(s.totals.paid)}
              </p>
            </div>
            <span className="text-muted-foreground hidden text-2xl sm:block" aria-hidden>
              =
            </span>
            <div
              className={`rounded-md border p-4 ${Number(s.totals.balance) > 0 ? "border-danger/20 bg-danger/[0.025]" : "border-success/20 bg-success/[0.025]"}`}
            >
              <p className="text-muted-foreground text-xs">{t("stillOwed")}</p>
              <p
                className={`mt-1 text-2xl font-semibold tabular-nums ${Number(s.totals.balance) > 0 ? "text-danger" : "text-success"}`}
              >
                {usd(s.totals.balance)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {Number(s.totals.balance) > 0 ? t("owedYears", { n: owedYears }) : t("allPaid")}
              </p>
            </div>
          </div>

          {/* Year by year; open a year to see each bill. */}
          <div className="overflow-hidden rounded-md border">
            <div className="text-muted-foreground bg-muted/50 grid grid-cols-[4.5rem_1fr_1fr_1fr_9rem] gap-3 px-4 py-2 text-xs font-medium">
              <span>{t("year")}</span>
              <span className="text-end">{t("chargedCol")}</span>
              <span className="text-end">{t("paidCol")}</span>
              <span className="text-end">{t("owedCol")}</span>
              <span />
            </div>
            {s.years.map((y) => (
              <details key={y.year} className="group border-t">
                <summary className="hover:bg-muted/40 grid cursor-pointer list-none grid-cols-[4.5rem_1fr_1fr_1fr_9rem] items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1 font-semibold">
                    <ChevronDown
                      className="size-3.5 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                    {y.year}
                  </span>
                  <span className="text-end tabular-nums">{usd(y.charged)}</span>
                  <span className="text-end tabular-nums">{usd(y.paid)}</span>
                  <span
                    className={`text-end font-medium tabular-nums ${Number(y.balance) > 0 ? "text-danger" : ""}`}
                  >
                    {usd(y.balance)}
                  </span>
                  <span className="text-end">
                    <StatusBadge tone={TONE[yearState(y)]}>
                      {t(`state.${yearState(y)}`)}
                    </StatusBadge>
                  </span>
                </summary>
                <ul className="bg-muted/30 divide-y text-xs">
                  {y.bills.map((b) => (
                    <li
                      key={b.id}
                      className="grid grid-cols-[4.5rem_1fr_1fr_1fr_9rem] items-center gap-3 px-4 py-2"
                    >
                      <span />
                      <span className="text-end tabular-nums">{usd(b.total)}</span>
                      <span className="text-end tabular-nums">{usd(b.paid)}</span>
                      <span
                        className={`text-end tabular-nums ${Number(b.balance) > 0 ? "text-danger" : ""}`}
                      >
                        {usd(b.balance)}
                      </span>
                      <span className="min-w-0 truncate text-end">
                        <Link href={`/invoices/${b.id}`} className="hover:text-primary font-mono">
                          {b.number}
                        </Link>
                        <span className="text-muted-foreground block truncate">
                          {lang === "so" ? b.fee_so : b.fee_en}
                          {b.pun && ` · ${b.pun}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <div className="bg-muted/50 grid grid-cols-[4.5rem_1fr_1fr_1fr_9rem] gap-3 border-t px-4 py-2.5 text-sm font-semibold">
              <span>{t("total")}</span>
              <span className="text-end tabular-nums">{usd(s.totals.charged)}</span>
              <span className="text-end tabular-nums">{usd(s.totals.paid)}</span>
              <span
                className={`text-end tabular-nums ${Number(s.totals.balance) > 0 ? "text-danger" : ""}`}
              >
                {usd(s.totals.balance)}
              </span>
              <span />
            </div>
          </div>

          {/* What they paid, and which years it went to. */}
          <div>
            <p className="mb-2 text-sm font-medium">{t("payments")}</p>
            {s.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noPayments")}</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                    <Link href={`/payments/${p.id}`} className="hover:text-primary font-mono">
                      {p.receipt_no}
                    </Link>
                    <span className="text-muted-foreground">
                      {format.dateTime(new Date(p.at), { dateStyle: "medium" })}
                    </span>
                    <span className="text-muted-foreground">
                      {t("forYears", { years: [...p.years].sort().join(", ") })}
                    </span>
                    <span className="text-success ms-auto font-medium tabular-nums">
                      {usd(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
