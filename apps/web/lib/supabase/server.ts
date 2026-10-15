import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { contextHeaders, requestContext } from "@/lib/server/request";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  // Read cookies first: it marks the route dynamic before env validation can throw at build time.
  const cookieStore = await cookies();
  const env = publicEnv();
  const ctx = await requestContext();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: contextHeaders(ctx) },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. Middleware refreshes sessions.
        }
      },
    },
  });
}
