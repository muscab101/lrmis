import { getTranslations } from "next-intl/server";
import { TabCount, tabClass } from "@/components/shell/tabs";
import { Link } from "@/i18n/navigation";
import type { Viewer } from "@/lib/server/auth";
import { parcelStageCounts } from "@/lib/server/parcels";
import { createClient } from "@/lib/supabase/server";

/** Owners: Partial registration · Registered · Managers, as tabs under the page title. */
export async function OwnersTabs({ viewer, active, kind }: { viewer: Viewer; active: "draft" | "registered" | "managers"; kind?: string | null }) {
  const t = await getTranslations("owners");
  const tn = await getTranslations("nav.items");
  const supabase = await createClient();
  const count = (registered: boolean) => {
    const req = supabase.from("parties").select("id", { count: "exact", head: true }).is("deleted_at", null);
    return registered ? req.not("registered_at", "is", null) : req.is("registered_at", null);
  };
  const [drafts, registered, managers] = await Promise.all([
    count(false),
    count(true),
    supabase.from("parcels").select("manager_party_id").eq("layout", "flats").is("deleted_at", null).not("manager_party_id", "is", null),
  ]);
  const managerCount = new Set(((managers.data ?? []) as { manager_party_id: string }[]).map((m) => m.manager_party_id)).size;
  const stageHref = (stage: string) => `/owners?${new URLSearchParams({ stage, ...(kind ? { kind } : {}) })}`;
  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("stages")}>
      <Link href={stageHref("draft")} aria-current={active === "draft" ? "page" : undefined} className={tabClass(active === "draft")}>
        {t("stage_draft")} <TabCount n={drafts.count ?? 0} />
      </Link>
      {viewer.can("owners.registered") && (
        <Link href={stageHref("registered")} aria-current={active === "registered" ? "page" : undefined} className={tabClass(active === "registered")}>
          {t("stage_registered")} <TabCount n={registered.count ?? 0} />
        </Link>
      )}
      {viewer.can("managers.view") && (
        <Link href="/owners/managers" aria-current={active === "managers" ? "page" : undefined} className={tabClass(active === "managers")}>
          {tn("managers")} <TabCount n={managerCount} />
        </Link>
      )}
    </nav>
  );
}

/** Parcels: Partial registration · Registered · Apartments, as tabs under the page title. */
export async function ParcelsTabs({
  viewer,
  active,
  query = {},
}: {
  viewer: Viewer;
  active: "draft" | "registered" | "apartments";
  /** Search and neighbourhood kept when moving between Partial and Registered. */
  query?: Record<string, string>;
}) {
  const t = await getTranslations("parcels");
  const tn = await getTranslations("nav.items");
  const counts = await parcelStageCounts();
  const href = (stage: string) => `/parcels?${new URLSearchParams({ stage, ...query })}`;
  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label={t("stages")}>
      <Link href={href("draft")} aria-current={active === "draft" ? "page" : undefined} className={tabClass(active === "draft")}>
        {t("stage_draft")} <TabCount n={counts.draft} />
      </Link>
      {viewer.can("parcels.registered") && (
        <Link href={href("registered")} aria-current={active === "registered" ? "page" : undefined} className={tabClass(active === "registered")}>
          {t("stage_registered")} <TabCount n={counts.registered} />
        </Link>
      )}
      {viewer.can("apartments.view") && (
        <Link href="/apartments" aria-current={active === "apartments" ? "page" : undefined} className={tabClass(active === "apartments")}>
          {tn("apartments")} <TabCount n={counts.flats} />
        </Link>
      )}
    </nav>
  );
}
