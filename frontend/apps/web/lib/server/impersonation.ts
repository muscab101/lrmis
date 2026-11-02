import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { IMPERSONATION_COOKIE, openImpersonation } from "@/lib/impersonation";

/** The test login in force for this signed-in user, if any. */
export const getImpersonation = cache(async (userId: string) => {
  const value = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  const v = await openImpersonation(value, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return v?.target === userId ? v : null;
});
