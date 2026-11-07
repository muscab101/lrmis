import type { ReactNode } from "react";
import { publicEnv } from "@/lib/env";
import type { Viewer } from "@/lib/server/auth";
import { profilePhotoUrl } from "@/lib/server/profile-photo";
import { AppShell } from "./app-shell";

export async function StaffShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  let env: "development" | "staging" | "production" = "development";
  try {
    env = publicEnv().NEXT_PUBLIC_APP_ENV;
  } catch {
    /* unconfigured: treat as dev */
  }
  return (
    <AppShell
      testingAs={viewer.testing ? viewer.profile.full_name || (viewer.profile.email ?? "") : null}
      permissions={[...viewer.permissions]}
      user={{ id: viewer.user.id, name: viewer.profile.full_name, email: viewer.profile.email, photo: await profilePhotoUrl(viewer.profile.avatar_path) }}
      env={env}
    >
      {children}
    </AppShell>
  );
}
