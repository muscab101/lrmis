import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** How certificates look (Admin → Certificate design). Empty titles use the standard ones. */
export interface CertificateDesign {
  accent: string;
  title_so: string | null;
  title_en: string | null;
  note: string | null;
  watermark: boolean;
  seals: boolean;
}

export const DEFAULT_DESIGN: CertificateDesign = { accent: "#1f45b8", title_so: null, title_en: null, note: null, watermark: true, seals: true };

/** The saved design (read by the server, also for the print agent's pages, which have no signed-in user). */
export async function getCertificateDesign(): Promise<CertificateDesign> {
  const admin = await createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", "certificates.design").maybeSingle();
  const v = (data?.value ?? {}) as Partial<CertificateDesign>;
  return {
    accent: typeof v.accent === "string" && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : DEFAULT_DESIGN.accent,
    title_so: v.title_so ?? null,
    title_en: v.title_en ?? null,
    note: v.note ?? null,
    watermark: v.watermark ?? true,
    seals: v.seals ?? true,
  };
}
