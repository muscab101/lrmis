import "server-only";
import type { Viewer } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import { neighbourhoodStatus } from "./parcels";
import { listZones } from "./zones";

/** One unfinished item: what it is, a short detail, when, and where to finish it. */
export interface IncompleteRow {
  id: string;
  title: string;
  detail: string | null;
  /** A status code, translated by the page for its group. */
  status: string | null;
  amount?: number | null;
  at: string | null;
  href: string;
}

export interface IncompleteGroup {
  key: "owners" | "parcels" | "zones" | "places" | "invoices" | "certificates" | "transfers" | "surveys" | "siteChecks" | "disputes" | "permits";
  count: number;
  rows: IncompleteRow[];
  /** The page with the full list. */
  href: string;
}

const LIMIT = 6;

type Rec = Record<string, unknown>;
const name = (v: unknown, lang: string) => {
  const o = v as { name_so?: string; name_en?: string } | null;
  return o ? (lang === "so" ? o.name_so : o.name_en) ?? null : null;
};

/**
 * Everything still unfinished that the viewer may see, newest first. Each group needs its view
 * permission, and the database only returns the viewer's districts (RLS).
 */
export async function incompleteWork(viewer: Viewer, lang: string): Promise<IncompleteGroup[]> {
  const supabase = await createClient();
  const can = (p: Parameters<Viewer["can"]>[0]) => viewer.can(p);
  const jobs: Promise<IncompleteGroup | null>[] = [];

  if (can("owners.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("parties")
          .select("id, full_name, phone, created_at", { count: "exact" })
          .is("deleted_at", null)
          .is("registered_at", null)
          .order("created_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "owners",
          count: count ?? 0,
          href: "/owners",
          rows: ((data ?? []) as Rec[]).map((r) => ({ id: r.id as string, title: r.full_name as string, detail: (r.phone as string | null) ?? null, status: null, at: r.created_at as string, href: `/owners/${r.id}` })),
        };
      })(),
    );
  }

  if (can("parcels.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("parcels")
          .select("id, pun, house_no, status, created_at, neighbourhood:neighbourhoods(name_so, name_en)", { count: "exact" })
          .is("deleted_at", null)
          .in("status", ["draft", "surveyed", "verified"])
          .order("created_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "parcels",
          count: count ?? 0,
          href: "/parcels/yet-to-register",
          rows: ((data ?? []) as Rec[]).map((r) => ({
            id: r.id as string,
            title: (r.pun as string | null) ?? [name(r.neighbourhood, lang), r.house_no].filter(Boolean).join(" · ") ?? "—",
            detail: name(r.neighbourhood, lang),
            status: r.status as string,
            at: r.created_at as string,
            href: `/parcels/${r.id}`,
          })),
        };
      })(),
    );
  }

  // Yet to register: survey zones still open (a surveyor sees their own), and neighbourhoods with land still waiting.
  if (can("surveys.view")) {
    jobs.push(
      (async () => {
        const zones = await listZones(!can("surveys.approve"), "open");
        return {
          key: "zones",
          count: zones.length,
          href: "/parcels/yet-to-register?tab=zones",
          rows: zones.slice(0, LIMIT).map((z) => ({
            id: z.id,
            title: `${lang === "so" ? z.name_so : z.name_en} · ${z.code}`,
            detail: [z.surveyor, `${z.recorded}/${z.target}`, lang === "so" ? z.district_so : z.district_en].filter(Boolean).join(" · "),
            status: null,
            at: z.assigned_at,
            href: "/parcels/yet-to-register?tab=zones",
          })),
        };
      })(),
    );
  }

  if (can("parcels.yet_to_register")) {
    jobs.push(
      (async () => {
        const places = (await neighbourhoodStatus(null))
          .filter((r) => r.partial > 0 || r.open_applications > 0)
          .sort((a, b) => b.partial + b.open_applications - (a.partial + a.open_applications));
        return {
          key: "places",
          count: places.length,
          href: "/parcels/yet-to-register?tab=waiting",
          rows: places.slice(0, LIMIT).map((r) => ({
            id: r.id,
            title: `${lang === "so" ? r.name_so : r.name_en} · ${r.code}`,
            detail: `${lang === "so" ? r.district_so : r.district_en} · ${r.partial} / ${r.open_applications}`,
            status: null,
            at: null,
            href: `/parcels?${new URLSearchParams({ stage: "draft", nbhd: r.id })}`,
          })),
        };
      })(),
    );
  }

  if (can("parcels.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("parcels")
          .select("id, pun, house_no, site_check_requested_at, neighbourhood:neighbourhoods(name_so, name_en)", { count: "exact" })
          .is("deleted_at", null)
          .eq("site_check_status", "pending")
          .order("site_check_requested_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "siteChecks",
          count: count ?? 0,
          href: "/surveys",
          rows: ((data ?? []) as Rec[]).map((r) => ({
            id: r.id as string,
            title: (r.pun as string | null) ?? [name(r.neighbourhood, lang), r.house_no].filter(Boolean).join(" · ") ?? "—",
            detail: name(r.neighbourhood, lang),
            status: null,
            at: r.site_check_requested_at as string | null,
            href: `/parcels/${r.id}`,
          })),
        };
      })(),
    );
  }

  if (can("invoices.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("invoices")
          .select("id, number, balance, due_date, status, parcel:parcels(pun), fee_type:fee_types(name_so, name_en)", { count: "exact" })
          .in("status", ["issued", "partially_paid"])
          .gt("balance", 0)
          .order("due_date", { ascending: true })
          .limit(LIMIT);
        return {
          key: "invoices",
          count: count ?? 0,
          href: "/invoices",
          rows: ((data ?? []) as Rec[]).map((r) => ({
            id: r.id as string,
            title: r.number as string,
            detail: [name(r.fee_type, lang), (r.parcel as { pun: string | null } | null)?.pun].filter(Boolean).join(" · ") || null,
            status: r.status as string,
            amount: Number(r.balance),
            at: r.due_date as string,
            href: `/invoices/${r.id}`,
          })),
        };
      })(),
    );
  }

  if (can("certificates.view") && can("parcels.view")) {
    jobs.push(
      (async () => {
        // Registered land that has no valid certificate yet (usually still unpaid).
        const [{ data: regs }, { data: certs }] = await Promise.all([
          supabase.from("parcels").select("id, pun, registered_at").is("deleted_at", null).eq("status", "registered").order("registered_at", { ascending: false }).limit(500),
          supabase.from("issued_documents").select("parcel_id").eq("type", "certificate").eq("status", "valid").limit(2000),
        ]);
        const has = new Set(((certs ?? []) as Rec[]).map((c) => c.parcel_id as string));
        const missing = ((regs ?? []) as Rec[]).filter((p) => !has.has(p.id as string));
        return {
          key: "certificates",
          count: missing.length,
          href: "/documents/print",
          rows: missing.slice(0, LIMIT).map((r) => ({ id: r.id as string, title: (r.pun as string) ?? "—", detail: null, status: null, at: r.registered_at as string | null, href: `/parcels/${r.id}` })),
        };
      })(),
    );
  }

  if (can("transfers.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("transfers")
          .select("id, number, status, created_at, parcel:parcels(pun)", { count: "exact" })
          .in("status", ["draft", "submitted"])
          .order("created_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "transfers",
          count: count ?? 0,
          href: "/transfers?f=submitted",
          rows: ((data ?? []) as Rec[]).map((r) => ({ id: r.id as string, title: r.number as string, detail: (r.parcel as { pun: string | null } | null)?.pun ?? null, status: r.status as string, at: r.created_at as string, href: `/transfers/${r.id}` })),
        };
      })(),
    );
  }

  if (can("surveys.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("surveys")
          .select("id, status, due_date, created_at, application:applications(number)", { count: "exact" })
          .in("status", ["assigned", "in_progress", "returned", "overlap_review"])
          .order("created_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "surveys",
          count: count ?? 0,
          href: "/surveys",
          rows: ((data ?? []) as Rec[]).map((r) => ({
            id: r.id as string,
            title: (r.application as { number: string } | null)?.number ?? "—",
            detail: null,
            status: r.status as string,
            at: (r.due_date as string | null) ?? (r.created_at as string),
            href: `/surveys/${r.id}`,
          })),
        };
      })(),
    );
  }

  if (can("disputes.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("disputes")
          .select("id, number, claimant_name, opened_at, parcel:parcels(pun)", { count: "exact" })
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "disputes",
          count: count ?? 0,
          href: "/disputes",
          rows: ((data ?? []) as Rec[]).map((r) => ({
            id: r.id as string,
            title: r.number as string,
            detail: [(r.parcel as { pun: string | null } | null)?.pun, r.claimant_name].filter(Boolean).join(" · ") || null,
            status: null,
            at: r.opened_at as string,
            href: "/disputes",
          })),
        };
      })(),
    );
  }

  if (can("permits.view")) {
    jobs.push(
      (async () => {
        const { data, count } = await supabase
          .from("permits")
          .select("id, number, status, requested_at, parcel:parcels(pun)", { count: "exact" })
          .in("status", ["draft", "submitted"])
          .order("requested_at", { ascending: false })
          .limit(LIMIT);
        return {
          key: "permits",
          count: count ?? 0,
          href: "/permits",
          rows: ((data ?? []) as Rec[]).map((r) => ({ id: r.id as string, title: r.number as string, detail: (r.parcel as { pun: string | null } | null)?.pun ?? null, status: r.status as string, at: r.requested_at as string, href: "/permits" })),
        };
      })(),
    );
  }

  // A group whose query fails is left out rather than breaking the page.
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
}
