import { Card, CardContent } from "@dhulka/ui/card";
import { Mono, PageHeader } from "@dhulka/ui/misc";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { RegisterAgainForm } from "@/components/demolitions/demolition-actions";
import { Link } from "@/i18n/navigation";
import { requirePermission } from "@/lib/server/auth";
import { getDemolition } from "@/lib/server/demolitions";
import { listPropertyTypes } from "@/lib/server/property-types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("demolitions");
  return { title: t("registerAgainTitle") };
}

/** The demolition was right and a new house stands there: register the land again (same PUN, new building number). */
export default async function RegisterAgainPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "parcels.demolish_approve");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const found = await getDemolition(id);
  if (!found) notFound();
  const { row: d } = found;
  // Only land that is demolished and not yet registered again.
  if (d.status !== "approved" || d.rebuilt_at) redirect(`/${locale}/demolished/${id}`);
  const t = await getTranslations("demolitions");
  const lang = await getLocale();
  const s = d.snapshot;
  const name = (o: { name_so: string; name_en: string } | null | undefined) =>
    o ? (lang === "so" ? o.name_so : o.name_en) : null;
  const [types, ownerRows] = await Promise.all([
    listPropertyTypes(),
    (await createClient())
      .from("parcel_owners")
      .select("party:parties(full_name)")
      .eq("parcel_id", d.parcel_id)
      .is("valid_to", null),
  ]);
  const grades = types
    .filter((g) => g.active)
    .map((g) => ({ code: g.code, name: lang === "so" ? g.name_so : g.name_en }));
  const owners = ((ownerRows.data ?? []) as unknown as { party: { full_name: string } | null }[])
    .map((o) => o.party?.full_name)
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/demolished/${d.id}`} className="hover:text-foreground">
            ← {d.number}
          </Link>
        }
        title={t("registerAgainTitle")}
        description={t("registerAgainBody")}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardContent className="pt-6">
            <RegisterAgainForm
              id={d.id}
              houseNo={s.house_no}
              owners={owners}
              grades={grades}
              cancelHref={`/demolished/${d.id}`}
            />
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardContent className="space-y-3 pt-6 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">PUN</p>
              <Mono>{s.pun ?? "—"}</Mono>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t("colHouse")}</p>
              <p>{s.house_no ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t("colPlace")}</p>
              <p>
                {[name(s.district), name(s.neighbourhood)].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t("ownersThen")}</p>
              <p>{s.owners.map((o) => o.full_name).join(", ") || "—"}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
