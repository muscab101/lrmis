import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";
import { contextHeaders, requestContext } from "@/lib/server/request";

/**
 * Service-role client: bypasses RLS. Only for Auth Admin API calls and service-only RPCs
 * (login lockout, setup). Never import from client components (eslint rule enforces this).
 */
export async function createAdminClient() {
  const ctx = await requestContext();
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: contextHeaders(ctx) },
  });
}

/** Throwaway anon client (no cookies) used to re-check a password without touching the session. */
export function createIsolatedClient() {
  const env = publicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
