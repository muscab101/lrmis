import { Card, CardDescription, CardHeader, CardTitle } from "@dhulka/ui/card";
import { EmptyState, Mono } from "@dhulka/ui/misc";
import { Home } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { OwnerHouse } from "@/components/owners/owner-statement";
import { ParcelStatusBadge } from "@/components/parcels/parcel-status-badge";
import { Link } from "@/i18n/navigation";

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
                <span className="text-primary grid size-7 shrink-0 place-items-center text-sm font-semibold tabular-nums">
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
