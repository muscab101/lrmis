import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { visibleNav } from "@/components/shell/nav";
import { askAssistant, assistantConfigured, isAssistantAdmin, type StaffContext } from "@/lib/server/assistant";
import { withinBudget } from "@/lib/server/assistant-budget";
import { getViewer } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  question: z.string().trim().min(3).max(500),
  locale: z.enum(["so", "en"]).default("so"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
  /** The finance panel on Reports: figures for people with the reports assistant. */
  reports: z.boolean().default(false),
});

/**
 * Staff help assistant for every staff member; administrators get the admin assistant (benefits, districts, figures),
 * and so does the Reports panel for people with the reports assistant.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  if (viewer.profile.kind !== "staff" || viewer.profile.status !== "active") return NextResponse.json({ code: "PERMISSION_DENIED" }, { status: 403 });
  if (!assistantConfigured()) return NextResponse.json({ code: "NOT_CONFIGURED" }, { status: 503 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "VALIDATION" }, { status: 400 });
  if (!withinBudget(viewer.user.id, 30)) return NextResponse.json({ code: "RATE_LIMITED" }, { status: 429 });

  const supabase = await createClient();
  const [admin, rolesRes, districtsRes, deskRes] = await Promise.all([
    isAssistantAdmin(supabase, viewer.user.id, viewer.isSuperAdmin),
    supabase.from("user_roles").select("roles!inner(name_en)").eq("user_id", viewer.user.id),
    supabase.from("user_districts").select("districts!inner(name_en)").eq("user_id", viewer.user.id),
    viewer.profile.point_of_sale_id
      ? supabase.from("points_of_sale").select("name").eq("id", viewer.profile.point_of_sale_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tn = await getTranslations({ locale: "en", namespace: "nav" });
  const who: StaffContext = {
    name: viewer.profile.full_name,
    roles: ((rolesRes.data ?? []) as unknown as { roles: { name_en: string } }[]).map((r) => r.roles.name_en),
    districts: viewer.profile.all_districts
      ? "all districts"
      : ((districtsRes.data ?? []) as unknown as { districts: { name_en: string } }[]).map((d) => d.districts.name_en).join(", ") || "none",
    desk: (deskRes.data as { name: string } | null)?.name ?? null,
    pages: visibleNav(viewer.can).flatMap((g) => g.items.map((i) => tn(`items.${i.key}`))),
  };

  try {
    const figures = admin || (parsed.data.reports && viewer.can("reports.assistant"));
    const answer = await askAssistant(supabase, parsed.data.question, parsed.data.locale, parsed.data.history, figures ? "admin" : "staff", who);
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("assistant failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ code: "UNAVAILABLE" }, { status: 502 });
  }
}
