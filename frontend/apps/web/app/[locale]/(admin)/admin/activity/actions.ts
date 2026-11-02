"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_SECONDS,
  sealImpersonation,
} from "@/lib/impersonation";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { getImpersonation } from "@/lib/server/impersonation";
import { RECORDINGS_BUCKET } from "@/lib/server/recordings";
import { createAdminClient } from "@/lib/supabase/admin";

/** Signs this browser in as the person, without any email being sent. */
async function signInAs(
  ctx: {
    supabase: {
      auth: {
        verifyOtp: (a: { token_hash: string; type: "magiclink" }) => Promise<{ error: unknown }>;
      };
    };
  },
  email: string,
) {
  const { data, error } = await (
    await createAdminClient()
  ).auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new AppFailure("UNKNOWN");
  const res = await ctx.supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (res.error) throw new AppFailure("UNKNOWN");
}

export const startTestLoginAction = defineAction(
  "admin.test_login.start",
  z.object({ userId: z.uuid() }),
  async (v, ctx) => {
    // The database refuses anyone but a super admin, and logs it.
    const email = unwrap(
      await ctx.supabase.rpc("admin_test_login_start", { p_user: v.userId }),
      "test login",
    ) as string;
    const seal = await sealImpersonation(
      {
        admin: ctx.user.id,
        target: v.userId,
        exp: Math.floor(Date.now() / 1000) + IMPERSONATION_SECONDS,
      },
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    );
    await signInAs(ctx, email);
    (await cookies()).set(IMPERSONATION_COOKIE, seal, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: IMPERSONATION_SECONDS,
    });
    return null;
  },
);

export const stopTestLoginAction = defineAction(
  "admin.test_login.stop",
  z.object({}),
  async (_v, ctx) => {
    const testing = await getImpersonation(ctx.user.id);
    if (!testing) throw new AppFailure("NOT_FOUND");
    const { data } = await (
      await createAdminClient()
    )
      .from("profiles")
      .select("email")
      .eq("user_id", testing.admin)
      .single();
    const email = (data as { email: string | null } | null)?.email;
    if (!email) throw new AppFailure("UNKNOWN");
    await signInAs(ctx, email);
    (await cookies()).delete(IMPERSONATION_COOKIE);
    unwrap(
      await ctx.supabase.rpc("admin_test_login_stop", { p_user: testing.target }),
      "test login",
    );
    return { target: testing.target };
  },
);

/** Short-lived links to the pieces of a recording. Only super admins get them, and it is logged. */
export const recordingPiecesAction = defineAction(
  "activity.recording_pieces",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    const paths = unwrap(
      await ctx.supabase.rpc("recording_watch", { p_recording: v.id }),
      "recording",
    ) as string[];
    if (!paths.length) return [];
    const { data, error } = await (
      await createAdminClient()
    ).storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrls(paths, 600);
    if (error) throw new AppFailure("UNKNOWN");
    return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
  },
);

export interface LivePerson {
  user_id: string;
  full_name: string | null;
  email: string | null;
  roles_so: string[];
  roles_en: string[];
  page: string | null;
}

export const liveListAction = defineAction(
  "activity.live_list",
  z.object({}),
  async (_v, ctx) =>
    (unwrap(await ctx.supabase.rpc("staff_live_list"), "live list") ?? []) as LivePerson[],
);

/** The new pieces of what a person is doing right now, as short-lived links. */
export const livePiecesAction = defineAction(
  "activity.live_pieces",
  z.object({ userId: z.uuid(), recording: z.uuid().nullable(), after: z.number().int() }),
  async (v, ctx) => {
    const data = unwrap(
      await ctx.supabase.rpc("recording_live_pieces", {
        p_user: v.userId,
        p_recording: v.recording,
        p_after: v.after,
      }),
      "live pieces",
    ) as { recording: string | null; pieces: { seq: number; path: string }[] };
    if (!data.pieces.length)
      return { recording: data.recording, pieces: [] as { seq: number; url: string }[] };
    const { data: links, error } = await (
      await createAdminClient()
    ).storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrls(
        data.pieces.map((p) => p.path),
        120,
      );
    if (error) throw new AppFailure("UNKNOWN");
    const url = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
    return {
      recording: data.recording,
      pieces: data.pieces.flatMap((p) => {
        const link = url.get(p.path);
        return link ? [{ seq: p.seq, url: link }] : [];
      }),
    };
  },
);
