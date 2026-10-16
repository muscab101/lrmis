import type { ReactNode } from "react";
import { publicEnv } from "@/lib/env";
import type { Viewer } from "@/lib/server/auth";
import { AppShell } from "./app-shell";

export function StaffShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  let env: "development" | "staging" | "production" = "development";
  try {
    env = publicEnv().NEXT_PUBLIC_APP_ENV;
  } catch {
    /* unconfigured: treat as dev */
  }
  return (
    <AppShell
      permissions={[...viewer.permissions]}
      user={{ id: viewer.user.id, name: viewer.profile.full_name, email: viewer.profile.email }}
      env={env}
    >
      {children}
    </AppShell>
  );
}
