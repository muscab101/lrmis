"use server";

import { redirect } from "next/navigation";

/** The verify form: normalise the typed code and open its page. */
export async function goToVerify(locale: string, form: FormData) {
  const code = String(form.get("code") ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  redirect(`/${locale === "en" ? "en" : "so"}/verify/${code || "-"}`);
}
