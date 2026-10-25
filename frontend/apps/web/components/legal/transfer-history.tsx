import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { StatusBadge } from "@dhulka/ui/badge";
import { Mono } from "@dhulka/ui/misc";
import { ArrowRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listTransfers } from "@/lib/server/legal";

const TONE: Record<string, "approved" | "rejected" | "pending" | "draft"> = {
  approved: "approved",
  rejected: "rejected",
  cancelled: "draft",
  submitted: "pending",
  draft: "draft",
};

/** Every transfer of a parcel, newest first: who it went from and to, and when. */
export async function TransferHistory({ parcelId, currentId }: { parcelId: string; currentId?: string }) {
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const rows = await listTransfers("any", parcelId);
  const names = (list: { full_name: string }[]) => list.map((o) => o.full_name).join(", ") || "—";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("transferHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noTransfers")}</p>
        ) : (
          <ol className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id} className={`space-y-1 py-3 first:pt-0 last:pb-0 ${r.id === currentId ? "bg-muted/40 -mx-2 rounded-md px-2" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/transfers/${r.id}`} className="hover:text-primary">
                      <Mono>{r.number}</Mono>
                    </Link>
                    <span className="text-muted-foreground">{t(`transferKinds.${r.kind}`)}</span>
                    <StatusBadge tone={TONE[r.status] ?? "draft"}>{t(`status.${r.status}`)}</StatusBadge>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {format.dateTime(new Date(r.decided_at ?? r.submitted_at ?? r.created_at), { dateStyle: "medium" })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{names(r.from_owners)}</span>
                  <ArrowRight className="text-muted-foreground size-4 rtl:rotate-180" aria-label={t("transferredTo")} />
                  <span className="font-medium">{names(r.to_owners)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
