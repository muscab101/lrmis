"use server";

import { trackSchema } from "@dhulka/core/schemas";
import { defineAction, unwrap } from "@/lib/server/action";

/** Public status lookup: number + last 4 digits of the applicant's phone. No personal data. */
export const trackAction = defineAction(
  "applications.track",
  trackSchema,
  async ({ number, phoneLast4 }, ctx) =>
    unwrap(await ctx.supabase.rpc("application_track", { p_number: number, p_phone_last4: phoneLast4 }), "track") as {
      number: string;
      type: string;
      status: string;
      submitted_at: string | null;
      district: string;
      events: { status: string; at: string }[];
    } | null,
  { public: true },
);
