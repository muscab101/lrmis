import { Card, CardContent, CardHeader, CardTitle } from "@dhulka/ui/card";
import { StatusBadge } from "@dhulka/ui/badge";
import { Mono } from "@dhulka/ui/misc";
import { ArrowRight } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listChanges, listTransfers } from "@/lib/server/legal";
import { createClient } from "@/lib/supabase/server";

const TONE: Record<string, "approved" | "rejected" | "pending" | "draft"> = {
  approved: "approved",
  rejected: "rejected",
  cancelled: "draft",
  submitted: "pending",
  draft: "draft",
};

/** Every transfer of a parcel, and every subdivision or merge it was part of, newest first: what it was, from whom or which land, to whom or which land, and when. */
export async function TransferHistory({
  parcelId,
  currentId,
}: {
  parcelId: string;
  currentId?: string;
}) {
  const t = await getTranslations("legal");
  const lang = await getLocale();
  const format = await getFormatter();
  const [rows, allChanges] = await Promise.all([
    listTransfers("any", parcelId),
    listChanges("any", parcelId),
  ]);
  const changes = allChanges.filter((c) => c.kind === "subdivide" || c.kind === "merge");
  const names = (list: { full_name: string }[]) => list.map((o) => o.full_name).join(", ") || "—";
  // Who owns each parcel that came out of a subdivision or merge.
  const resultIds = [...new Set(changes.flatMap((c) => c.result_parcel_ids))];
  const ownersOf = new Map<string, string[]>();
  if (resultIds.length) {
    const { data } = await (
      await createClient()
    )
      .from("parcel_owners")
      .select("parcel_id, party:parties(full_name)")
      .in("parcel_id", resultIds)
      .is("valid_to", null);
    for (const o of (data ?? []) as unknown as {
      parcel_id: string;
      party: { full_name: string } | null;
    }[])
      ownersOf.set(o.parcel_id, [...(ownersOf.get(o.parcel_id) ?? []), o.party?.full_name ?? ""]);
  }
  const items = [
    ...rows.map((r) => ({
      type: "transfer" as const,
      at: r.decided_at ?? r.submitted_at ?? r.created_at,
      r,
    })),
    ...changes.map((c) => ({ type: "change" as const, at: c.decided_at ?? c.requested_at, c })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("transferHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noTransfers")}</p>
        ) : (
          <ol className="divide-y text-sm">
            {items.map((it) =>
              it.type === "change" ? (
                <li key={it.c.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Mono>{it.c.number}</Mono>
                      <span className="text-muted-foreground">{t(`changeKinds.${it.c.kind}`)}</span>
                      <StatusBadge tone={TONE[it.c.status] ?? "draft"}>
                        {t(`status.${it.c.status}`)}
                      </StatusBadge>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {format.dateTime(new Date(it.at), { dateStyle: "medium" })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Mono>{it.c.puns.join(", ")}</Mono>
                    <ArrowRight
                      className="text-muted-foreground mt-0.5 size-4 rtl:rotate-180"
                      aria-label={t("transferredTo")}
                    />
                    {it.c.result_parcel_ids.length === 0 ? (
                      <span className="text-muted-foreground">
                        {t("changeChildrenPending", {
                          n: (it.c.payload.children ?? []).length || 1,
                        })}
                      </span>
                    ) : (
                      <ul className="space-y-0.5">
                        {it.c.result_parcel_ids.map((id, i) => (
                          <li key={id}>
                            <Link href={`/parcels/${id}`} className="hover:text-primary">
                              <Mono>{it.c.result_puns[i]}</Mono>
                            </Link>
                            <span className="font-medium">
                              {" "}
                              · {(ownersOf.get(id) ?? []).join(", ") || "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {it.c.reason && <p className="text-muted-foreground text-xs">{it.c.reason}</p>}
                </li>
              ) : (
                <li
                  key={it.r.id}
                  className={`space-y-1 py-3 first:pt-0 last:pb-0 ${it.r.id === currentId ? "bg-muted/40 -mx-2 rounded-md px-2" : ""}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/transfers/${it.r.id}`} className="hover:text-primary">
                        <Mono>{it.r.number}</Mono>
                      </Link>
                      <span className="text-muted-foreground">
                        {it.r.type ? (lang === "so" ? it.r.type.name_so : it.r.type.name_en) : t(`transferKinds.${it.r.kind}`)}
                      </span>
                      <StatusBadge tone={TONE[it.r.status] ?? "draft"}>
                        {t(`status.${it.r.status}`)}
                      </StatusBadge>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {format.dateTime(
                        new Date(it.r.decided_at ?? it.r.submitted_at ?? it.r.created_at),
                        {
                          dateStyle: "medium",
                        },
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{names(it.r.from_owners)}</span>
                    <ArrowRight
                      className="text-muted-foreground size-4 rtl:rotate-180"
                      aria-label={t("transferredTo")}
                    />
                    <span className="font-medium">{names(it.r.to_owners)}</span>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
