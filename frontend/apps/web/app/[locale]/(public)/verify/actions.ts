"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { defineAction } from "@/lib/server/action";

/** The verify form without JavaScript: normalise the typed code and open its page. */
export async function goToVerify(locale: string, form: FormData) {
  const code = String(form.get("code") ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  redirect(`/${locale === "en" ? "en" : "so"}/verify/${code || "-"}`);
}

export interface VerifyResult {
  type: "certificate" | "id_card";
  status: "valid" | "cancelled" | "expired";
  serial: string;
  pun: string;
  issued_at: string;
  expires_at: string | null;
  tax_year: number | null;
  district: string;
  district_en: string;
  neighbourhood: string | null;
  neighbourhood_en: string | null;
  area_m2: number | null;
  cancelled_at: string | null;
  owners: string[];
}

const codeSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{12}$/, "validation.verify_code") });

/** Check a code and return the non-personal details (null: no such document). */
export const verifyCodeAction = defineAction(
  "verify.check",
  codeSchema,
  async ({ code }, ctx) => {
    const { data } = await ctx.supabase.rpc("verify_document", { p_code: code });
    return { code, result: (data ?? null) as VerifyResult | null };
  },
  { public: true },
);
