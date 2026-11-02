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

export const screenRequestAction = defineAction(
  "activity.screen_request",
  z.object({ userId: z.uuid() }),
  async (v, ctx) =>
    unwrap(await ctx.supabase.rpc("screen_request", { p_user: v.userId }), "screen request"),
);

export const screenRespondAction = defineAction(
  "activity.screen_respond",
  z.object({ id: z.uuid(), status: z.enum(["sharing", "declined", "failed"]) }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("screen_respond", { p_id: v.id, p_status: v.status }),
      "screen respond",
    ),
);

export const screenPrepareUploadAction = defineAction(
  "activity.screen_prepare",
  z.object({ id: z.uuid(), ext: z.enum(["webm", "mp4"]) }),
  async (v, ctx) => {
    const path = `${ctx.user.id}/screen/${v.id}.${v.ext}`;
    const { data, error } = await (
      await createAdminClient()
    ).storage
      .from(RECORDINGS_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new AppFailure("UNKNOWN");
    return { bucket: RECORDINGS_BUCKET, path, token: data.token };
  },
);

export const screenFinishAction = defineAction(
  "activity.screen_finish",
  z.object({ id: z.uuid(), path: z.string().max(300), bytes: z.number().int().min(0) }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("screen_finish", { p_id: v.id, p_path: v.path, p_bytes: v.bytes }),
      "screen finish",
    ),
);

export const screenLinkAction = defineAction(
  "activity.screen_link",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    const path = unwrap(await ctx.supabase.rpc("screen_watch", { p_id: v.id }), "screen") as string;
    const { data, error } = await (
      await createAdminClient()
    ).storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(path, 3600);
    if (error || !data) throw new AppFailure("UNKNOWN");
    return data.signedUrl;
  },
);
