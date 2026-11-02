"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppFailure, defineAction, unwrap } from "@/lib/server/action";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "chat-media";
const MB = 1024 * 1024;
/** What can be sent, as what, and how big. The bucket enforces the types and 50 MB as well. */
const FILE_TYPES: Record<string, { kind: "image" | "video"; ext: string; max: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 10 * MB },
  "image/png": { kind: "image", ext: "png", max: 10 * MB },
  "image/webp": { kind: "image", ext: "webp", max: 10 * MB },
  "image/gif": { kind: "image", ext: "gif", max: 10 * MB },
  "video/mp4": { kind: "video", ext: "mp4", max: 50 * MB },
  "video/webm": { kind: "video", ext: "webm", max: 50 * MB },
  "video/quicktime": { kind: "video", ext: "mov", max: 50 * MB },
};

export interface ChatRow {
  id: string;
  kind: "direct" | "group";
  name: string;
  last_message_at: string;
  last_body: string | null;
  last_file_kind: "image" | "video" | null;
  last_sender: string | null;
  unread: number;
  member_count: number;
  created_by: string | null;
}

export interface ChatMessage {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string | null;
  file_path: string | null;
  file_kind: "image" | "video" | null;
  file_name: string | null;
  created_at: string;
  deleted: boolean;
  /** A short-lived link to the file; only members get one. */
  file_url: string | null;
}

export type ChatPerson = { user_id: string; full_name: string; email: string | null };

export const chatListAction = defineAction(
  "chat.list",
  z.object({}),
  async (_v, ctx) => unwrap(await ctx.supabase.rpc("chat_list"), "chats") as ChatRow[],
);

/** A page of messages, oldest first. The database only answers members, so only they get links to the files. */
export const chatMessagesAction = defineAction(
  "chat.messages",
  z.object({ conversationId: z.uuid(), before: z.string().nullable().default(null) }),
  async (v, ctx) => {
    const rows = unwrap(
      await ctx.supabase.rpc("chat_messages_page", {
        p_conversation: v.conversationId,
        p_before: v.before,
        p_limit: 50,
      }),
      "messages",
    ) as Omit<ChatMessage, "file_url">[];
    const paths = rows.map((r) => r.file_path).filter((p): p is string => !!p);
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data } = await (
        await createAdminClient()
      ).storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);
      for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    }
    return rows
      .map((r) => ({ ...r, file_url: r.file_path ? (urls.get(r.file_path) ?? null) : null }))
      .reverse() as ChatMessage[];
  },
);

export const chatDirectoryAction = defineAction(
  "chat.directory",
  z.object({ q: z.string().max(80).default("") }),
  async (v, ctx) =>
    unwrap(await ctx.supabase.rpc("chat_directory", { p_q: v.q }), "directory") as ChatPerson[],
);

export const chatOpenDirectAction = defineAction(
  "chat.open_direct",
  z.object({ userId: z.uuid() }),
  async (v, ctx) =>
    unwrap(await ctx.supabase.rpc("chat_open_direct", { p_user: v.userId }), "open chat") as string,
);

export const chatCreateGroupAction = defineAction(
  "chat.create_group",
  z.object({ name: z.string().trim().max(80), members: z.array(z.uuid()).max(200) }),
  async (v, ctx) => {
    try {
      return unwrap(
        await ctx.supabase.rpc("chat_create_group", { p_name: v.name, p_members: v.members }),
        "create group",
      ) as string;
    } catch (err) {
      const detail = err instanceof AppFailure ? String(err.values?.detail ?? "") : "";
      if (err instanceof AppFailure && detail === "chat_group_name")
        throw new AppFailure(err.code, err.values, { name: ["validation.chat_group_name"] });
      if (err instanceof AppFailure && detail === "chat_members")
        throw new AppFailure(err.code, err.values, { members: ["validation.chat_members"] });
      throw err;
    }
  },
);

export const chatMembersAction = defineAction(
  "chat.members",
  z.object({ conversationId: z.uuid() }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("chat_members_of", { p_conversation: v.conversationId }),
      "members",
    ) as ChatPerson[],
);

export const chatAddMembersAction = defineAction(
  "chat.add_members",
  z.object({ conversationId: z.uuid(), members: z.array(z.uuid()).min(1).max(200) }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("chat_add_members", {
        p_conversation: v.conversationId,
        p_members: v.members,
      }),
      "add members",
    ),
);

export const chatRemoveMemberAction = defineAction(
  "chat.remove_member",
  z.object({ conversationId: z.uuid(), userId: z.uuid() }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("chat_remove_member", {
        p_conversation: v.conversationId,
        p_user: v.userId,
      }),
      "remove member",
    ),
);

/**
 * Permission to upload one file straight to storage (large videos don't fit through the server). Only members of the
 * chat get it, for one new file in that chat's folder.
 */
export const chatPrepareUploadAction = defineAction(
  "chat.prepare_upload",
  z.object({
    conversationId: z.uuid(),
    type: z.string().max(100),
    size: z.number().int().positive(),
  }),
  async (v, ctx) => {
    const member = unwrap(
      await ctx.supabase.rpc("chat_is_member", { p_conversation: v.conversationId }),
      "member",
    ) as boolean;
    if (!member) throw new AppFailure("NOT_FOUND", { detail: "conversation" });
    const file = FILE_TYPES[v.type];
    if (!file) throw new AppFailure("VALIDATION", { detail: "chat_file_type" });
    if (v.size > file.max)
      throw new AppFailure("VALIDATION", {
        detail: file.kind === "image" ? "chat_image_too_big" : "chat_video_too_big",
      });
    const path = `${v.conversationId}/${randomUUID()}.${file.ext}`;
    const { data, error } = await (
      await createAdminClient()
    ).storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw new AppFailure("UNKNOWN");
    return { bucket: BUCKET, path, token: data.token, kind: file.kind };
  },
);

export const chatSendAction = defineAction(
  "chat.send",
  z.object({
    conversationId: z.uuid(),
    body: z.string().max(4000).default(""),
    file: z
      .object({
        path: z.string().max(200),
        kind: z.enum(["image", "video"]),
        name: z.string().max(200),
      })
      .nullable()
      .default(null),
  }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("chat_send", {
        p_conversation: v.conversationId,
        p_body: v.body,
        p_file_path: v.file?.path ?? null,
        p_file_kind: v.file?.kind ?? null,
        p_file_name: v.file?.name ?? null,
      }),
      "send",
    ) as string,
);

export const chatMarkReadAction = defineAction(
  "chat.mark_read",
  z.object({ conversationId: z.uuid() }),
  async (v, ctx) =>
    unwrap(
      await ctx.supabase.rpc("chat_mark_read", { p_conversation: v.conversationId }),
      "mark read",
    ),
);

export const chatDeleteMessageAction = defineAction(
  "chat.delete_message",
  z.object({ id: z.uuid() }),
  async (v, ctx) => {
    const path = unwrap(
      await ctx.supabase.rpc("chat_delete_message", { p_id: v.id }),
      "delete message",
    ) as string | null;
    if (path) await (await createAdminClient()).storage.from(BUCKET).remove([path]);
    return null;
  },
);
