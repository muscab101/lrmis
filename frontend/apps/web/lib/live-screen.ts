import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * A person's screen sent straight to a super admin who is watching, over the private realtime channel live:<user id>.
 * The watcher sends "watch" (fresh: true the first time, to get a new picture of the page); the person's browser sends
 * "screen" parts: gzipped batches of rrweb events, split so each message stays small.
 */
export const liveTopic = (userId: string) => `live:${userId}`;
export const WATCH_EVENT = "watch";
export const SCREEN_EVENT = "screen";
export const WATCH_EVERY_MS = 5_000;

const PART_CHARS = 150_000;

export type ScreenPart = { id: string; i: number; n: number; data: string };

export async function openLiveChannel(userId: string): Promise<RealtimeChannel> {
  const supabase = createClient();
  await supabase.realtime.setAuth();
  return supabase.channel(liveTopic(userId), {
    config: { private: true, broadcast: { self: false } },
  });
}

export function closeLiveChannel(channel: RealtimeChannel) {
  void createClient().removeChannel(channel);
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string) {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** A batch of events as the parts to send. */
export async function encodeScreen(events: unknown[]): Promise<ScreenPart[]> {
  const stream = new Blob([JSON.stringify(events)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const text = toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
  const id = crypto.randomUUID();
  const n = Math.max(1, Math.ceil(text.length / PART_CHARS));
  return Array.from({ length: n }, (_, i) => ({
    id,
    i,
    n,
    data: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS),
  }));
}

/** Puts parts back together; gives the events once every part of a batch has come. */
export function screenAssembler() {
  const held = new Map<string, string[]>();
  return async (part: ScreenPart): Promise<{ timestamp: number; type: number }[] | null> => {
    const parts = held.get(part.id) ?? new Array<string>(part.n);
    parts[part.i] = part.data;
    held.set(part.id, parts);
    if (parts.filter((p) => p !== undefined).length < part.n) return null;
    held.delete(part.id);
    const stream = new Blob([fromBase64(parts.join(""))])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as { timestamp: number; type: number }[];
  };
}
