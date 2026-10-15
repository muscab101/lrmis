import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { StaffShell } from "@/components/shell/staff-shell";
import { requireStaff } from "@/lib/server/auth";

// Per-user page: never prerender or cache.
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireStaff(locale);
  return <StaffShell viewer={viewer}>{children}</StaffShell>;
}
