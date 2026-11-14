import { forbidden } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { StaffShell } from "@/components/shell/staff-shell";
import { requireStaff } from "@/lib/server/auth";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

/** Admin panel: any admin-area permission gets in; each page checks its own permission. */
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  const allowed = ["users.view", "roles.view", "audit.view", "settings.view", "certificates.signature"] as const;
  if (!allowed.some((p) => viewer.can(p))) forbidden();
  return <StaffShell viewer={viewer}>{children}</StaffShell>;
}
