import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { WELCOME_COOKIE } from "@/lib/welcome";
import { publicEnv } from "@/lib/env";
import type { Viewer } from "@/lib/server/auth";
import { userOffice } from "@/lib/server/office";
import { profilePhotoUrl } from "@/lib/server/profile-photo";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "./app-shell";
import { WelcomeSplash } from "./welcome-splash";

export async function StaffShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  let env: "development" | "staging" | "production" = "development";
  try {
    env = publicEnv().NEXT_PUBLIC_APP_ENV;
  } catch {
    /* unconfigured: treat as dev */
  }
  // Just signed in: the welcome screen covers the first paint, then lifts away.
  const welcome = (await cookies()).get(WELCOME_COOKIE)?.value === "1";
  // Staff activity recording can be switched off in Settings (security.staff_recording): then no recorder runs.
  const [photo, recording, office] = await Promise.all([
    profilePhotoUrl(viewer.profile.avatar_path),
    createClient().then(async (s) => (await s.rpc("staff_recording_on")).data === true),
    userOffice(),
  ]);
  return (
    <>
      {welcome && <WelcomeSplash name={viewer.profile.full_name} />}
      <AppShell
        testingAs={viewer.testing ? viewer.profile.full_name || (viewer.profile.email ?? "") : null}
        permissions={[...viewer.permissions]}
        user={{
          id: viewer.user.id,
          name: viewer.profile.full_name,
          email: viewer.profile.email,
          photo,
        }}
        env={env}
        recording={recording}
        office={office}
      >
        {children}
      </AppShell>
    </>
  );
}
